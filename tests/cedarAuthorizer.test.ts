import { describe, it, expect } from 'vitest';
import { CedarInlineAuthorizationEngine, CedarInlineAuthorizerConfiguration } from '../src/cedarInlineAuthorizationEngine';
import { AuthorizationRequest, Entity } from '../src/index';

describe('CedarInlineAuthorizationEngine', () => {

    function setUpAuthorizer(shouldAllowAll: boolean, validateRequest: boolean): CedarInlineAuthorizationEngine {
        const schema = JSON.stringify({
            TestNamespace: {
                entityTypes: {
                    User: {
                        shape: {
                            attributes: {},
                            type: 'Record'
                        },
                        memberOfTypes: []
                    },
                    Resource: {
                        shape: {
                            attributes: {},
                            type: 'Record'
                        },
                        memberOfTypes: []
                    }
                },
                actions: {
                    Read: {
                        appliesTo: {
                            principalTypes: ['User'],
                            resourceTypes: ['Resource'],
                            context: {
                                type: 'Record',
                                attributes: {}
                            }
                        }
                    }
                }
            }
        });
        const config: CedarInlineAuthorizerConfiguration = {
            staticPolicies: shouldAllowAll ? 'permit(principal, action, resource);' : 'forbid(principal,action,resource);',
            schema: { type: 'jsonString', schema: schema },
            validateRequest,
        };

        // Create authorizer instance
        return new CedarInlineAuthorizationEngine(config);

    }

    it('should initialize successfully with valid policies', () => {
        const authorizer = setUpAuthorizer(true, false);
        expect(authorizer).toBeInstanceOf(CedarInlineAuthorizationEngine);
    });

    it('should return allow when authorization is successful', async () => {
        // Setup test request
        const request: AuthorizationRequest = {
            principal: { type: 'TestNamespace::User', id: 'alice' },
            action: { type: 'TestNamespace::Action', id: 'Read' },
            resource: { type: 'TestNamespace::Resource', id: 'document1' },
            context: {}
        };

        const entities: Entity[] = [
            {
                uid: { type: 'TestNamespace::User', id: 'alice' },
                attrs: {},
                parents: []
            },
            {
                uid: { type: 'TestNamespace::Resource', id: 'document1' },
                attrs: {},
                parents: []
            }
        ];

        // Execute authorization request
        const authorizer = setUpAuthorizer(true, true);
        const result = await authorizer.isAuthorized(request, entities);

        // Verify result
        expect(result.type).toBe('allow');
        if (result.type === 'allow') {
            expect(result.authorizerInfo.principalUid).toEqual(request.principal);
            expect(result.authorizerInfo.determiningPolicies).toEqual(['policy0']);
        }
    });

    it('should handle authorization denial', async () => {
        const request: AuthorizationRequest = {
            principal: { type: 'TestNamespace::User', id: 'bob' },
            action: { type: 'TestNamespace::Action', id: 'Read' },
            resource: { type: 'TestNamespace::Resource', id: 'document1' },
            context: {}
        };

        const entities: Entity[] = [
            {
                uid: { type: 'TestNamespace::User', id: 'bob' },
                attrs: {},
                parents: []
            },
            {
                uid: { type: 'TestNamespace::Resource', id: 'document1' },
                attrs: {},
                parents: []
            }
        ];

        const authorizer = setUpAuthorizer(false, true);
        const result = await authorizer.isAuthorized(request, entities);
        expect(result.type).toBe('deny');
    });

    it('should handle authorization errors', async () => {
        const request: AuthorizationRequest = {
            principal: { type: '', id: 'unknown' },
            action: { type: 'TestNamespace::Action', id: 'Read' },
            resource: { type: 'TestNamespace::Resource', id: 'document1' },
            context: {}
        };

        const entities: Entity[] = [];

        const authorizer = setUpAuthorizer(true, false);
        const result = await authorizer.isAuthorized(request, entities);

        expect(result.type).toBe('error');
        if (result.type === 'error') {
            expect(result.message.includes("failed to parse principal")).toBe(true);
        }
    });

    it('should handle validation errors', async () => {
        const request: AuthorizationRequest = {
            principal: { type: 'TestNamespace', id: 'unknown' },
            action: { type: 'TestNamespace::Action', id: 'InvalidActionNotInSchema' },
            resource: { type: 'TestNamespace::Resource', id: 'document1' },
            context: {}
        };

        const entities: Entity[] = [];

        const authorizer = setUpAuthorizer(true, true);
        const result = await authorizer.isAuthorized(request, entities);

        expect(result.type).toBe('error');
        if (result.type === 'error') {
            expect(result.message.match(/InvalidActionNotInSchema[^ ]+ does not exist in the supplied schema/)).toBeTruthy();
        }
    });
});