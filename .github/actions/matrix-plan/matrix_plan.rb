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

unless config.is_a?(Hash) && config.key?("defaults")
  abort("Invalid matrix config: missing top-level 'defaults' in #{config_path}")
end

defaults_root = config.fetch("defaults")
defaults = defaults_root.fetch(test_type) do
  abort("Invalid matrix config: defaults missing key '#{test_type}' in #{config_path}")
end

global = config["global"].is_a?(Hash) ? config["global"] : {}
min_shards_global = (global["min_shards"] || 1).to_i
clamp_to_caps = global.key?("clamp_to_caps") ? !!global["clamp_to_caps"] : true

# --- Helpers ---------------------------------------------------------------

def int_or_nil(value)
  return nil if value.nil?
  s = value.to_s.strip
  s.empty? ? nil : s.to_i
end

def csv_to_list(csv)
  return [] if csv.nil? || csv.strip.empty?
  csv.split(",").map(&:strip).reject(&:empty?)
end

# --- Shard calculation (governed + capped) ---------------------------------
#
# Option A YAML contract:
#   defaults.<type>.default_shards
#   defaults.<type>.max_shards
#
# override_shards:
#   - if provided -> requested
#   - else -> default_shards
#
# final shards:
#   - min bound: global.min_shards (default 1)
#   - max bound: defaults.max_shards
#   - clamped only if global.clamp_to_caps=true

default_shards = defaults.fetch("default_shards")
max_shards     = defaults.fetch("max_shards")

requested = int_or_nil(override_shards) || default_shards.to_i

# Minimum bound
requested = [requested, min_shards_global].max

# Cap / clamp
shards =
  if clamp_to_caps
    [requested, max_shards.to_i].min
  else
    requested
  end

# Safety: never allow 0 or negative
shards = [shards, 1].max

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
