#!/usr/bin/env node
import { Tools, MappingType } from './tools';
import fs from 'fs';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as cedar from '@cedar-policy/cedar-wasm/nodejs';
import { OpenAPIV3 } from 'openapi-types';

async function main(): Promise<void> {
  try {
    const argv = await yargs(hideBin(process.argv))
      .command('generate-schema', 'Generate Cedar schema from OpenAPI spec', (yargs) => {
        return yargs
          .option('api-spec', {
            describe: 'Path to the OpenAPI spec file',
            type: 'string',
            demandOption: true
          })
          .option('namespace', {
            describe: 'Cedar namespace for your application',
            type: 'string',
            demandOption: true
          })
          .option('mapping-type', {
            describe: 'Mapping type',
            type: 'string',
            default: 'SimpleRest',
            choices: ['SimpleRest'] as const
          });
      })
      .command('generate-policies', 'Generate policies for a Cedar schema', (yargs) => {
        return yargs
          .option('schema', {
            describe: 'Path to the Cedar schema file',
            type: 'string',
            demandOption: true
          });
      })
      .demandCommand(1, 'You need to specify a command')
      .help()
      .argv;

    const command = argv._[0];

    if (command === 'generate-schema') {
      const apiSpecFile = argv['api-spec'] as string;
      const namespace = argv.namespace as string;
      const mappingType = argv['mapping-type'] as MappingType;

      // Check if API spec file exists
      if (!fs.existsSync(apiSpecFile)) {
        console.error(`Error: API spec file not found: ${apiSpecFile}`);
        process.exit(1);
      }

      const apiSpecContent = fs.readFileSync(apiSpecFile, 'utf-8');
      let openApiSpec: OpenAPIV3.Document;
      try {
        openApiSpec = JSON.parse(apiSpecContent) as OpenAPIV3.Document;
      } catch(e) {
        console.error(`Error: Invalid JSON in API spec file: ${apiSpecFile}`);
        process.exit(1);
      }

      const authMapping = Tools.generateApiMappingSchemaFromOpenAPISpec(
        openApiSpec,
        namespace,
        mappingType
      );
      
      const fileNames = ['v2.cedarschema.json', 'v4.cedarschema.json'];
      console.log(`Cedar schema successfully generated. Your schema files are named: ${fileNames.join(', ')}.`);
      console.log(`${fileNames[0]} is compatible with Cedar 2.x and 3.x`);
      console.log(`${fileNames[1]} is compatible with Cedar 4.x and required by the nodejs Cedar plugins.`);
      fs.writeFileSync(path.join(process.cwd(), fileNames[0]), authMapping.schemaV2);
      fs.writeFileSync(path.join(process.cwd(), fileNames[1]), authMapping.schemaV4);
    } 
    else if (command === 'generate-policies') {
      const schemaPath = argv.schema as string;
      
      // Check if schema file exists
      if (!fs.existsSync(schemaPath)) {
        console.error(`Error: Schema file not found: ${schemaPath}`);
        process.exit(1);
      }

      const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
      const policies = Tools.generatePoliciesForSchema(cedar, {
        type: 'jsonString',
        schema: schemaContent
      });

      policies.forEach((policy, index) => {
        //check if cedar subdirectory exists and create it if not:
        const cedarPoliciesFolderName = 'policies';
        if (!fs.existsSync('policies')) {
          fs.mkdirSync('policies');
        }
        const outputFile = `policy_${index + 1}.cedar`;
        fs.writeFileSync(path.join(process.cwd(), cedarPoliciesFolderName, outputFile), policy);
        console.log(`Cedar policy successfully generated in ${cedarPoliciesFolderName}/${outputFile}`);
      });
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Execute the main function
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});