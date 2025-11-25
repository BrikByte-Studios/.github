/**
 * CLI validator for `brikpipe.build.yml` using JSON Schema.
 *
 * PIPE-BUILD-SCHEMA-TEST-004 — Add Schema Validation for Per-Language Pipeline Config
 *
 * Usage (from repo root):
 *   node .github/scripts/validate-build-config.mjs \
 *     --file brikpipe.build.yml \
 *     --schema .github/schemas/brikpipe-build.schema.json
 *
 * Exit codes:
 *   0 → config is valid
 *   1 → config is invalid or cannot be loaded
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Simple helper to parse CLI arguments into a key/value map.
 * Supports flags like: --file path/to/config.yml --schema path/to/schema.json
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    if (current.startsWith('--')) {
      const key = current.replace(/^--/, '');
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

/**
 * Load and parse a YAML file from disk.
 * @param {string} filePath - Path to the YAML file.
 * @returns {any} Parsed JavaScript object.
 * @throws If the file does not exist or cannot be parsed.
 */
function loadYamlFile(filePath) {
  const absPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Config file not found at: ${absPath}`);
  }

  const content = fs.readFileSync(absPath, 'utf8');
  return parseYaml(content);
}

/**
 * Load and parse a JSON Schema from disk.
 * @param {string} schemaPath - Path to the JSON schema file.
 * @returns {any} Parsed schema object.
 * @throws If the file does not exist or cannot be parsed.
 */
function loadJsonSchema(schemaPath) {
  const absPath = path.resolve(process.cwd(), schemaPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Schema file not found at: ${absPath}`);
  }

  const content = fs.readFileSync(absPath, 'utf8');
  return JSON.parse(content);
}

/**
 * Validate a config object against the provided schema using AJV.
 * @param {object} schema - JSON Schema object.
 * @param {any} config - Config object parsed from YAML.
 * @returns {{ valid: boolean; errors: import('ajv').ErrorObject[] | null | undefined }}
 */
function validateConfig(schema, config) {
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);

  const validate = ajv.compile(schema);
  const valid = validate(config);

  return { valid: Boolean(valid), errors: validate.errors || null };
}

/**
 * Print validation errors in a human-friendly way, and also as machine-readable JSON.
 * @param {import('ajv').ErrorObject[]} errors
 */
function printErrors(errors) {
  console.error('❌ brikpipe.build.yml is INVALID:');
  for (const err of errors) {
    console.error(`- [${err.instancePath || '/'}] ${err.message}`);
  }

  // Machine-readable form, useful for tools or logs.
  console.error('\n--- Raw error payload (JSON) ---');
  console.error(JSON.stringify(errors, null, 2));
}

/**
 * Main entrypoint.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  const configPath = args.file || 'brikpipe.build.yml';
  const schemaPath =
    args.schema || '.github/schemas/brikpipe-build.schema.json';

  try {
    console.log(`🔍 Validating config: ${configPath}`);
    console.log(`📘 Using schema:    ${schemaPath}`);

    const schema = loadJsonSchema(schemaPath);
    const config = loadYamlFile(configPath);

    const { valid, errors } = validateConfig(schema, config);

    if (!valid) {
      printErrors(errors || []);
      process.exitCode = 1;
      return;
    }

    console.log('✅ brikpipe.build.yml is VALID according to schema.');
    process.exitCode = 0;
  } catch (error) {
    console.error('❌ Validation failed due to an error:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('❌ Unexpected error during validation:');
  console.error(err);
  process.exit(1);
});
