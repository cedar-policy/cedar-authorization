import { describe, it, expect } from 'vitest';
import { Tools } from '../src/tools';
import { OpenAPIV3 } from 'openapi-types';
import { CedarOpenAPIExtension } from '../src';

describe('generateApiMappingSchemaFromOpenAPISpec', () => {
    it('should generate a schema from a simple OpenAPI spec', () => {
        // Create a simple OpenAPI spec for testing
        const openApiSpec: OpenAPIV3.Document<CedarOpenAPIExtension> = {
            openapi: '3.0.0',
            info: {
                title: 'Test API',
                version: '1.0.0'
            },
            paths: {
                '/users': {
                    get: {
                        operationId: 'getUsers',
                        responses: {
                            '200': {
                                description: 'Success'
                            }
                        }
                    },
                    post: {
                        operationId: 'createUser',
                        responses: {
                            '201': {
                                description: 'Created'
                            }
                        }
                    }
                },
                '/users/{id}': {
                    get: {
                        operationId: 'getUserById',
                        'x-cedar': {
                            appliesToResourceTypes: ['User']
                        },
                        parameters: [
                            {
                                name: 'id',
                                in: 'path',
                                required: true,
                                schema: {
                                    type: 'string'
                                }
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'Success'
                            }
                        }
                    }
                }
            }
        };

        const namespace = 'TestAPI';
        const mappingType = 'SimpleRest';

        // Generate the schema
        const result = Tools.generateApiMappingSchemaFromOpenAPISpec(openApiSpec, namespace, mappingType);

        // Verify the result
        expect(result).toBeDefined();
        expect(result.mappingType).toBe('SimpleRest');
        const parsedSchema = JSON.parse(result.schemaV4);
        expect(parsedSchema).toBeDefined();
        expect(parsedSchema[namespace]).toBeDefined();

        // Check entity types
        const entityTypes = parsedSchema[namespace].entityTypes;
        expect(entityTypes).toBeDefined();
        expect(entityTypes.User).toBeDefined();
        expect(entityTypes.UserGroup).toBeDefined();
        expect(entityTypes.Application).toBeDefined();

        // Check actions
        const actions = parsedSchema[namespace].actions;
        expect(actions).toBeDefined();
        expect(actions.getUsers).toBeDefined();
        expect(actions.createUser).toBeDefined();
        expect(actions.getUserById).toBeDefined();

        // Check action annotations
        expect(actions.getUsers.annotations.httpVerb).toBe('get');
        expect(actions.getUsers.annotations.httpPathTemplate).toBe('/users');
        expect(actions.createUser.annotations.httpVerb).toBe('post');
        expect(actions.getUserById.annotations.httpPathTemplate).toBe('/users/{id}');

        // Check resource override
        expect(actions.getUserById.appliesTo?.resourceTypes).toEqual(['User']);
    });

    it('should generate a schema with commonTypes for an openApi spec with openAPI schemas', () => {
        const openApiSpec: OpenAPIV3.Document<CedarOpenAPIExtension> = {
            openapi: '3.0.0',
            info: {
                title: 'Test API',
                version: '1.0.0'
            },
            paths: {
                '/users': {
                    get: {
                        operationId: 'getUsers',
                        'x-cedar': {
                            'appliesToResourceTypes': ['Spine']
                        },
                        responses: {
                            '200': {
                                description: 'Success'
                            }
                        }
                    }
                }
            },
            components: {
                schemas: {
                    T1: {
                        $ref: '#/components/schemas/T2'
                    },
                    T2: {
                        type: 'array',
                        items: {
                            $ref: '#/components/schemas/T3'
                        }
                    },
                    T3: {
                        type: 'string'
                    },
                    Marrow: {
                        type: 'array',
                        items: {
                            type: 'array',
                            items: {
                                type: 'array',
                                items: {
                                    $ref: '#/components/schemas/T1'
                                }
                            }
                        }
                    },
                    Bone: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    },
                    Spine: {
                        type: 'object',
                        properties: {
                            spineprop1: {
                                type: 'object',
                                properties: {
                                    doublenested1: {
                                        $ref: '#/components/schemas/T3'
                                    },
                                    doublenested2: {
                                        type: 'array',
                                        items: {
                                            type: 'integer'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    Skull: {
                        type: 'boolean'
                    }
                }
            }            
        };

        const namespace = 'TestAPI';
        const mappingType = 'SimpleRest';

        // Generate the schema
        const result = Tools.generateApiMappingSchemaFromOpenAPISpec(openApiSpec, namespace, mappingType);

        // Verify the result
        expect(result).toBeDefined();
        expect(result.mappingType).toBe('SimpleRest');
        const parsedSchema = JSON.parse(result.schemaV4);
        expect(parsedSchema).toBeDefined();
        expect(parsedSchema[namespace]).toBeDefined();
        expect(parsedSchema[namespace].commonTypes).toBeDefined();
        expect(Object.keys(parsedSchema[namespace].commonTypes).sort()).toStrictEqual([
            'Bone',
            'Marrow',
            'Skull',
            'Spine',
            'T1',
            'T2',
            'T3'
        ]);
        expect(parsedSchema[namespace].entityTypes).toBeDefined();
        expect(Object.keys(parsedSchema[namespace].entityTypes).sort()).toStrictEqual([
            'Application',
            'Spine',
            'User',
            'UserGroup',
        ]);
        expect(parsedSchema[namespace].entityTypes.Spine).toBeDefined();
        expect(parsedSchema[namespace].entityTypes.Spine?.shape).toStrictEqual({type: 'Spine'});
        expect(parsedSchema[namespace].commonTypes?.Spine?.attributes).toStrictEqual({
            spineprop1: {
                type: 'Record',
                attributes: {
                    doublenested1: {
                        type: 'T3',
                    },
                    doublenested2: {
                        element: {
                            type: 'Long'
                        },
                        type: 'Set',
                    }
                }
            }
        });

        // now assert on actions
        expect(parsedSchema[namespace].actions).toBeDefined();
        expect(Object.keys(parsedSchema[namespace].actions).sort()).toStrictEqual([
            'getUsers',
        ]); 
        expect(parsedSchema[namespace].actions.getUsers.appliesTo.resourceTypes).toStrictEqual(['Spine']);
    });

    it('should throw an error when OpenAPI spec is missing paths', () => {
        const invalidSpec = {
            openapi: '3.0.0',
            info: {
                title: 'Invalid API',
                version: '1.0.0'
            }
        };

        expect(() => {
            Tools.generateApiMappingSchemaFromOpenAPISpec(invalidSpec as OpenAPIV3.Document, 'TestAPI', 'SimpleRest');
        }).toThrow('Invalid OpenAPI spec - missing paths object');
    });

    const spec: OpenAPIV3.Document = {
        openapi: '3.0.0',
        info: {
            title: 'Test API',
            version: '1.0.0'
        },
        paths: {
            '/test': {
                get: {
                    operationId: 'test',
                    responses: {
                        '200': {
                            description: 'Success'
                        }
                    }
                }
            }
        }
    };

    const invalidInputError = 'Invalid namespace format. Namespace must start with a letter or underscore (_), and can include alphanumeric characters and underscores. Double colons (::) can separate components, where each component must start with a letter or underscore. Reserved words cannot be used as namespaces.';

    it('should accept valid namespaces', () => {
        const validNamespaces = [
            'MyNamespace',
            '_MyNamespace',
            'My_Namespace',
            'MyNamespace123',
            'MyNamespace::SubNamespace',
            'MyNamespace::SubNamespace::AnotherLevel',
            'a', // Minimum valid namespace
            'a'.repeat(128), // Maximum length namespace
        ];

        validNamespaces.forEach(namespace => {
            expect(() => {
                Tools.generateApiMappingSchemaFromOpenAPISpec(spec, namespace, 'SimpleRest');
            }).not.toThrow();
        });
    });

    it('should throw an error when namespace is missing', () => {
        expect(() => {
            Tools.generateApiMappingSchemaFromOpenAPISpec(spec, '', 'SimpleRest');
        }).toThrow('Invalid input - missing namespace');
    });

    it('should accept valid namespaces', () => {
        const validNamespaces = [
            'MyNamespace',
            '_MyNamespace',
            'My_Namespace',
            'MyNamespace123',
            'MyNamespace::SubNamespace',
            'MyNamespace::_SubNamespace',
            'MyNamespace::SubNamespace::AnotherLevel',
            'a', // Minimum valid namespace
            'VeryLongNamespace' + 'a'.repeat(1000), // Long namespace should be fine
        ];
    
        validNamespaces.forEach(namespace => {
            expect(() => {
                Tools.generateApiMappingSchemaFromOpenAPISpec(spec, namespace, 'SimpleRest');
            }).not.toThrow();
        });
    });
    
    it('should throw an error for invalid namespaces', () => {
        const invalidNamespaces = [
            // Invalid starting characters
            '123MyNamespace',
            '@MyNamespace',
            
            // Invalid characters
            'My@Namespace',
            'My Namespace',
            'My-Namespace',
            
            // Invalid :: usage
            'MyNamespace:SubNamespace', // Single colon
            'MyNamespace::',  // Ends with ::
            '::MyNamespace',  // Starts with ::
            'MyNamespace::::SubNamespace', // Multiple ::
            'MyNamespace::123SubNamespace', // Component after :: starts with number
            
            // Special characters
            '@#@',
            
            // Reserved words
            'if',
            'in',
            'is',
            '__cedar',
        ];
    
        invalidNamespaces.forEach(namespace => {
            expect(() => {
                Tools.generateApiMappingSchemaFromOpenAPISpec(spec, namespace, 'SimpleRest');
            }).toThrow(invalidInputError);
        });
    });
    


});
