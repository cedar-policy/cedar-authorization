import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { OpenAPIV3 } from 'openapi-types';
import { Tools } from '../src/tools'; 

const cedarLib = require('@cedar-policy/cedar-wasm/nodejs');

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

const arbAttribute = fc.letrec(tie => {
    return {
        actualVal: fc.oneof({maxDepth: 6}, tie('primitive'), tie('array'), tie('object'), tie('$ref')),
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

// Cedar reserved words that cannot be used as keys
const CEDAR_RESERVED_WORDS = [
    'if', 'then', 'else', 'like', 'in', 'is', '__cedar',
    'permit', 'forbid', 'when', 'unless', 'has', 'principal',
    'action', 'resource', 'context'
];

// Custom generator for valid Cedar property names
const arbValidCommonTypeName = fc.string({
    unit: fc.constantFrom(...lowerCase),
    minLength: 1,
    maxLength: 10,
}).filter(str => !CEDAR_RESERVED_WORDS.includes(str));

const arbOpenApiSchemaRecord = fc.dictionary(
    arbValidCommonTypeName,
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
        console.log('should generate the correct number of actions for an arb schema...')
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
                    const generatedCedarSchemaStr = Tools.generateApiMappingSchemaFromOpenAPISpec({
                        openApiSpec,
                        namespace: 'NS',
                        mappingType: 'SimpleRest',
                    }).schemaV4;
                    const generatedCedarSchema = JSON.parse(generatedCedarSchemaStr);
                    expect(Object.keys(generatedCedarSchema['NS'].actions).length).to.equal(numActionsInApiSpec);
                    const parseResult = cedarLib.checkParseSchema(generatedCedarSchema);
                    expect(parseResult.type).to.equal('success');
                }
            )
        )
    });

    
    it('should convert all OpenAPI schemas to commonTypes', () =>{
        console.log('should convert all OpenAPI schemas to commonTypes...');
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
                    
                    const generatedCedarSchemaStr = Tools.generateApiMappingSchemaFromOpenAPISpec({
                        openApiSpec,
                        namespace: 'NS',
                        mappingType: 'SimpleRest',
                    }).schemaV4;
                    const generatedCedarSchema = JSON.parse(generatedCedarSchemaStr);

                    expect(generatedCedarSchema.NS.commonTypes).toBeDefined();

                    const expectedCommonTypes = Object.keys(parsedArbOpenApiSchema).sort();
                    const actualCommonTypes = Object.keys(generatedCedarSchema.NS.commonTypes).sort();

                    expect(actualCommonTypes).toStrictEqual(expectedCommonTypes);

                    const parseResult = cedarLib.checkParseSchema(generatedCedarSchema);
                    expect(parseResult.type).to.equal('success');
                }
            )
        )
    });

    it('should convert corectly between a list of OpenAPI parameters and cedar context definition', () => {
        console.log('should convert corectly between a list of OpenAPI parameters and cedar context definition...');
        const lowerCase = 'abcdefghijklmnopqrstuvwxyz';
        const chars = lowerCase + lowerCase.toUpperCase();
        const arbName = () => fc.string({minLength: 4, maxLength: 16, unit: fc.constantFrom(...chars)});
        const arbType = () => fc.constantFrom('path', 'query', 'header', 'cookie');
        const arbSchema = () => fc.constantFrom(
            'str',
            'strUuid',
            'int',
            'num',
            'bool',
            'array|str',
            'array|bool',
            'array|int',
            'refPerson',
            'objectBook',
        );
        
        fc.assert(
            fc.property(fc.gen(), g => {
                const numberOfParameters = g(() => fc.integer({min: 8, max: 30}));
                const openApiParameters: OpenAPIV3.ParameterObject[] = [];
                const generatedCedarContextDefinition = {
                    pathParameters: {
                        type: 'Record',
                        attributes: {},
                    },
                    queryStringParameters: {
                        type: 'Record',
                        attributes: {},
                    },
                };
                for (let i = 0; i < numberOfParameters; i++) {
                    const attrName = g(arbName);
                    const paramType = g(arbType);
                    const schemaType = g(arbSchema);
                    const openApiParameterObject: OpenAPIV3.ParameterObject = {
                        name:attrName,
                        in: paramType as unknown as string,
                        schema: (function(){
                            switch(schemaType) {
                                case 'str': return {type: 'string'};
                                case 'strUuid': return {type: 'string', format: 'uuid'};
                                case 'int': return {type: 'integer'};
                                case 'num': return {type: 'number'};
                                case 'bool': return {type: 'boolean'};
                                case 'array|str': return {type: 'array', items: {type: 'string'}}
                                case 'array|bool': return {type: 'array', items: {type: 'boolean'}}
                                case 'array|int': return {type: 'array', items: {type: 'integer'}}
                                case 'refPerson': return {'$ref': '#/components/schemas/Person'};
                                case 'objectBook': return {
                                    type: 'object',
                                    properties: {
                                        email: {type: 'string', format: 'email'},
                                        firstName: {type: 'string'},
                                        lastName: {type: 'string'},
                                        age: {type: 'integer'},
                                        income: {type: 'number'},
                                    },
                                }
                            }
                        })(),
                    }
                    openApiParameters.push(openApiParameterObject);
                    const cedarContextAttribute = (function(){
                            switch(schemaType) {
                                case 'str': return {type: 'String'};
                                case 'strUuid': return {type: 'String'};
                                case 'int': return {type: 'Long'};
                                case 'num': return {type: 'Long'};
                                case 'bool': return {type: 'Boolean'};
                                case 'array|str': return {type: 'Set', element: {type: 'String'}}
                                case 'array|bool': return {type: 'Set', element: {type: 'Boolean'}}
                                case 'array|int': return {type: 'Set', element: {type: 'Long'}}
                                case 'refPerson': return {type: 'Person'};
                                case 'objectBook': return {
                                    type: 'Record',
                                    attributes: {
                                        email: {type: 'String'},
                                        firstName: {type: 'String'},
                                        lastName: {type: 'String'},
                                        age: {type: 'Long'},
                                        income: {type: 'Long'},
                                    },
                                }
                            }
                        })();
                    if (paramType === 'path' as const) {
                        Object.assign(generatedCedarContextDefinition.pathParameters.attributes, {
                            [attrName]: cedarContextAttribute,
                        });
                    } else if (paramType === 'query' as const) {
                        Object.assign(generatedCedarContextDefinition.queryStringParameters.attributes, {
                            [attrName]: cedarContextAttribute,
                        });
                    }
                }
                const convertedFromOpenApiToCedar = Tools._convertOpenApiParametersToContextdefinition(openApiParameters);
                if (!('attributes' in convertedFromOpenApiToCedar.pathParameters)) {
                    throw new Error('Test failed! Converted schema path params was not Record type');
                }
                if (!('attributes' in convertedFromOpenApiToCedar.queryStringParameters)) {
                    throw new Error('Test failed! Converted schema query params was not Record type');
                }
                expect(
                    Object.keys(generatedCedarContextDefinition.pathParameters.attributes).sort()
                ).toStrictEqual(
                    Object.keys(convertedFromOpenApiToCedar.pathParameters.attributes).sort()
                );
                expect(
                    Object.keys(generatedCedarContextDefinition.queryStringParameters.attributes).sort()
                ).toStrictEqual(
                    Object.keys(convertedFromOpenApiToCedar.queryStringParameters.attributes).sort()
                );
                expect(generatedCedarContextDefinition).toEqual(convertedFromOpenApiToCedar);
            })
        );
    });
});
