#!/usr/bin/env ruby
# Purpose:
#   Deterministically generates a GitHub Actions matrix for a given test type
#   while enforcing platform-level shard caps.
#
# Guarantees:
#   - No randomness
#   - Stable shard numbering (1..N)
#   - Stable ordering (sorted inputs)
#   - Hard caps to prevent CI cost explosions
#
# Inputs (ARGV):
#   0: test_type        (unit | integration | e2e | performance)
#   1: config_path      (parallel-matrix.yml)
#   2: override_shards  (optional int)
#   3: browsers_csv     (optional CSV, E2E only)
#   4: items_csv        (optional CSV; semantics depend on test_type)
#   5: services_csv     (optional CSV, integration only)
#   6: scenarios_csv    (optional CSV, integration only)
#
# Integration strategy:
#   - Prefer explicit pairs if items_csv provided (service::scenario)
#   - Else compute cross-product services_csv × scenarios_csv
#   - Distribute pairs across shards deterministically (round-robin)
#   - Emit strategy.matrix as { "include": [ {shard, items_csv}, ... ] }
#
# Output:
#   Writes `matrix_json=<json>` to GITHUB_OUTPUT
# -----------------------------------------------------------------------------

require "yaml"
require "json"

test_type, config_path, override_shards, browsers_csv, items_csv, services_csv, scenarios_csv = ARGV

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
  return [] if csv.nil?
  s = csv.to_s.strip
  return [] if s.empty?
  s.split(",").map(&:strip).reject(&:empty?)
end

def stable_list(list)
  list.compact.map(&:to_s).map(&:strip).reject(&:empty?).sort
end

def parse_pairs_from_items(items)
  # items like: ["users::happy_path", "payments::timeout"]
  pairs = []
  items.each do |t|
    svc, sc = t.split("::", 2)
    next if svc.nil? || sc.nil?
    svc = svc.strip
    sc  = sc.strip
    next if svc.empty? || sc.empty?
    pairs << [svc, sc]
  end
  pairs.sort_by { |svc, sc| [svc, sc] }
end

def cross_product_pairs(services, scenarios)
  pairs = []
  services.each do |svc|
    scenarios.each do |sc|
      pairs << [svc, sc]
    end
  end
  pairs.sort_by { |svc, sc| [svc, sc] }
end

def shard_round_robin(pairs, shards)
  buckets = Array.new(shards) { [] }
  pairs.each_with_index do |pair, idx|
    buckets[idx % shards] << pair
  end
  buckets
end

# --- Shard calculation (governed + capped) ---------------------------------

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

browsers  = stable_list(csv_to_list(browsers_csv))
items     = stable_list(csv_to_list(items_csv))
services  = stable_list(csv_to_list(services_csv))
scenarios = stable_list(csv_to_list(scenarios_csv))

if test_type == "e2e" && browsers.empty?
  browsers = defaults.fetch("browsers", [])
end

# --- Matrix construction per test type ------------------------------------

matrix =
  case test_type
  when "unit"
    # 0-based shards: 0..(shards-1)
    { "shard" => (0...shards).to_a }

  when "integration"
    pairs =
      if !items.empty?
        parse_pairs_from_items(items)
      elsif !services.empty? && !scenarios.empty?
        cross_product_pairs(services, scenarios)
      else
        []
      end

    if pairs.empty?
      { "shard" => (0...shards).to_a }
    else
      buckets = shard_round_robin(pairs, shards)

      include_rows = []
      buckets.each_with_index do |bucket, i|
        shard_index = i # 0-based
        csv = bucket.map { |svc, sc| "#{svc}::#{sc}" }.join(",")

        include_rows << {
          "shard" => shard_index,
          "items_csv" => csv
        }
      end

      { "include" => include_rows }
    end

  when "e2e"
    { "browser" => browsers, "shard" => (0...shards).to_a }

  when "performance"
    items.empty? ? { "shard" => (0...shards).to_a } : { "group" => items }

  else
    abort("Unsupported test_type: #{test_type}")
  end

matrix_json = JSON.generate(matrix)

# --- Output ----------------------------------------------------------------

if ENV["GITHUB_OUTPUT"]
  File.open(ENV["GITHUB_OUTPUT"], "a") do |file|
    file.puts("matrix_json=#{matrix_json}")
  end
else
  puts matrix_json
end
