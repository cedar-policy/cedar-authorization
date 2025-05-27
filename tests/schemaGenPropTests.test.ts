import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { OpenAPIV3 } from 'openapi-types';
import { Tools } from '../src/tools'; 

const lowerCase = 'abcdefghijklmnopqrstuvwxyz';
const upperCase = lowerCase.toUpperCase();
const VALID_CHARS = `-_${lowerCase}${upperCase}`.split('');

const arbOpenApiSinglePathDef = fc.record({
    pathSegments: fc.array(
        fc.string({
            unit: fc.constantFrom(...VALID_CHARS),
            minLength: 1,
            maxLength: 10,
        }),
        { minLength: 1, maxLength: 25 }
    ),
    verbs: fc.uniqueArray(
        fc.constantFrom('get', 'post', 'put', 'delete', 'patch'),
        { minLength: 1, maxLength: 5 }
    ),
});

const arbAttribute =  fc.letrec(tie => {
    return {
        actualVal: fc.oneof(tie('primitive'), tie('array'), tie('object'), tie('$ref')),
        primitive: fc.record({
            type: fc.constantFrom('number', 'integer', 'boolean', 'string'),
        }),
        array: fc.record({
            type: fc.constantFrom('array'),
            items: tie('actualVal')
        }),
        object: fc.record({
            type: fc.constantFrom('object'),
            properties: fc.dictionary(
                fc.string({
                    unit: fc.constantFrom(...lowerCase),
                    minLength: 1,
                    maxLength: 10,
                }),
                tie('actualVal')
            )
        }),
        '$ref': fc.record({
            '$ref': fc.constantFrom('#/components/schemas/%SCHEMANAME%')
        })
    };
});

const arbOpenApiSchemaRecord = fc.dictionary(
    fc.string({
        unit: fc.constantFrom(...lowerCase),
        minLength: 1,
        maxLength: 10,
    }),
    fc.oneof(
        fc.record({
            type: fc.constantFrom('object'),
            properties: fc.dictionary(
                fc.string({
                    unit: fc.constantFrom(...lowerCase),
                    minLength: 1,
                    maxLength: 10,
                }),
                arbAttribute.actualVal
            )
        }),
        fc.record({
            type: fc.constantFrom('number', 'integer', 'boolean', 'string'),
        }),
        fc.record({
            type: fc.constantFrom('array'),
            items: arbAttribute.actualVal,
        }),
        fc.record({
            '$ref': fc.constantFrom('#/components/schemas/%SCHEMANAME%')
        })
    )
)

describe('schema generation proptests', () => {
    it('should generate the correct number of actions for an arb schema', () => {
        fc.assert(
            fc.property(
                fc.uniqueArray(
                    arbOpenApiSinglePathDef,
                    {
                        minLength: 10,
                        maxLength: 25,
                        comparator: (r1, r2) => r1.pathSegments.join('') === r2.pathSegments.join('')
                    }
                ),
                (arbOpenApiPathDefs) => {
                    const openApiSpec: OpenAPIV3.Document = {
                        openapi: '3.0.0',
                        info: {
                            title: 'sample-express-app',
                            version: '1.0.0',
                            license: {
                                name: 'ISC'
                            },
                            description: 'fuzzed api spec'
                        },
                        paths: {},
                        tags: [],
                    };
                    let numActionsInApiSpec = 0;
                    for (const pathDataObj of arbOpenApiPathDefs) {
                        numActionsInApiSpec += pathDataObj.verbs.length;
                        const path = '/' + pathDataObj.pathSegments.join('/');
                        openApiSpec.paths[path] = {};
                        for (const verb of pathDataObj.verbs) {
                            openApiSpec.paths[path][verb] = {
                                responses: {
                                    '200': {
                                        description: 'OK'
                                    }
                                }
                            };
                        }
                    }
                    const generatedCedarSchemaStr = Tools.generateApiMappingSchemaFromOpenAPISpec(openApiSpec, 'NS', 'SimpleRest').schemaV4;
                    const generatedCedarSchema = JSON.parse(generatedCedarSchemaStr);
                    expect(Object.keys(generatedCedarSchema['NS'].actions).length).to.equal(numActionsInApiSpec);
                }
            )
        )
    });

    
    it('should convert all OpenAPI schemas to commonTypes', () =>{
        fc.assert(
            fc.property(
                arbOpenApiSchemaRecord,
                (arbOpenApiSchemaObj) => {
                    // let's replace %SCHEMANAME% with some new type,
                    // this guarantees that all $refs point to a top level schema type
                    // in order to make the test easier to reason about
                    let stringifiedArbOpenApiSchema = JSON.stringify(arbOpenApiSchemaObj);
                    const numRefs = stringifiedArbOpenApiSchema.split('%SCHEMANAME%').length - 1;
                    for (let i = 0; i < numRefs; i++) {
                        stringifiedArbOpenApiSchema = stringifiedArbOpenApiSchema.replace('%SCHEMANAME%', `T${i}`);
                    }
                    const parsedArbOpenApiSchema = JSON.parse(stringifiedArbOpenApiSchema);
                    for (let i = 0; i < numRefs; i++) {
                        Object.assign(parsedArbOpenApiSchema, {
                            [`T${i}`]: {type: 'string'}
                        });
                    }
                    const openApiSpec = {
                        openapi: '3.0.0',
                        info: {
                            title: 'sample-express-app',
                            version: '1.0.0',
                            license: {
                                name: 'ISC'
                            },
                            description: 'api spec with fuzzed commontypes'
                        },
                        paths: {},
                        components: {
                            schemas: parsedArbOpenApiSchema,
                        }
                    } as OpenAPIV3.Document;
                    
                    const generatedCedarSchemaStr = Tools.generateApiMappingSchemaFromOpenAPISpec(openApiSpec, 'NS', 'SimpleRest').schemaV4;
                    const generatedCedarSchema = JSON.parse(generatedCedarSchemaStr);

                    expect(generatedCedarSchema.NS.commonTypes).toBeDefined();

                    const expectedCommonTypes = Object.keys(parsedArbOpenApiSchema).sort();
                    const actualCommonTypes = Object.keys(generatedCedarSchema.NS.commonTypes).sort();

                    expect(actualCommonTypes).toStrictEqual(expectedCommonTypes);

                }
            )
        )
    });
});
