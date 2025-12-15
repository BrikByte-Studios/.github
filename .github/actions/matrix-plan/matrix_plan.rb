#!/usr/bin/env ruby
# -----------------------------------------------------------------------------
# matrix_plan.rb
# -----------------------------------------------------------------------------
# Purpose:
#   Deterministically generates a GitHub Actions matrix for a given test type
#   while enforcing platform-level shard caps.
#
# Guarantees:
#   - No randomness
#   - Stable shard numbering (1..N)
#   - Explicit browser / scenario lists
#   - Hard caps to prevent CI cost explosions
#
# Inputs (ARGV):
#   0: test_type        (unit | integration | e2e | performance)
#   1: config_path      (parallel-matrix.yml)
#   2: override_shards  (optional int)
#   3: browsers_csv     (optional CSV, E2E only)
#   4: items_csv        (optional CSV of scenario/service IDs)
#
# Output:
#   Writes `matrix_json=<json>` to GITHUB_OUTPUT
# -----------------------------------------------------------------------------

require "yaml"
require "json"

test_type, config_path, override_shards, browsers_csv, items_csv = ARGV

# If the caller didn't provide a config_path, use the action's bundled config.
if config_path.nil? || config_path.strip.empty?
  action_dir = File.expand_path(File.dirname(__FILE__))
  config_path = File.join(action_dir, "parallel-matrix.yml")
end

config = YAML.load_file(config_path)
defaults = config.fetch("defaults").fetch(test_type)

# --- Helpers ---------------------------------------------------------------

def int_or_nil(value)
  value.nil? || value.strip.empty? ? nil : value.to_i
end

def csv_to_list(csv)
  return [] if csv.nil? || csv.strip.empty?
  csv.split(",").map(&:strip).reject(&:empty?)
end

# --- Shard calculation (governed + capped) ---------------------------------

requested = int_or_nil(override_shards) || defaults.fetch("max_shards")
cap = defaults.fetch("cap")

# Clamp shard count to safe bounds
shards = [[requested, 1].max, cap].min

# --- Deterministic inputs ---------------------------------------------------

browsers = csv_to_list(browsers_csv)
items    = csv_to_list(items_csv)

if test_type == "e2e" && browsers.empty?
  browsers = defaults.fetch("browsers", [])
end

# --- Matrix construction per test type ------------------------------------

matrix =
  case test_type
  when "unit"
    # Simple shard-based fan-out
    { "shard" => (1..shards).to_a }

  when "integration"
    # Deterministic service/scenario grouping if provided
    items.empty? ? { "shard" => (1..shards).to_a } : { "item" => items }

  when "e2e"
    # Cross-product: browser × shard
    { "browser" => browsers, "shard" => (1..shards).to_a }

  when "performance"
    # Prefer explicit scenario groups, fallback to minimal sharding
    items.empty? ? { "shard" => (1..shards).to_a } : { "group" => items }

  else
    abort("Unsupported test_type: #{test_type}")
  end

# GitHub Actions expects a JSON object for strategy.matrix
matrix_json = JSON.generate(matrix)

# --- Output ----------------------------------------------------------------

if ENV["GITHUB_OUTPUT"]
  File.open(ENV["GITHUB_OUTPUT"], "a") do |file|
    file.puts("matrix_json=#{matrix_json}")
  end
else
  puts matrix_json
end
