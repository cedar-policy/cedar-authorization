import { AuthorizationCall, PolicySet, SchemaJson, ValidationCall } from "@cedar-policy/cedar-wasm";
import { AuthorizationRequest, AuthorizationResult, AuthorizationEngine, Entity, StringifiedSchema, assertUnreachable } from "./index";
import { Tools } from "./tools";
import { assert } from "console";


export interface CedarInlineAuthorizerConfiguration {
    staticPolicies: string;
    schema: StringifiedSchema;
    validateRequest?: boolean;
}

export class CedarInlineAuthorizationEngine implements AuthorizationEngine {
    // policies is a big string with all policies in it
    private readonly policies: PolicySet;
    private readonly cedar: typeof import('@cedar-policy/cedar-wasm/nodejs');
    private readonly schema: SchemaJson<string>;
    private readonly validateRequest: boolean;

    constructor(config: CedarInlineAuthorizerConfiguration) {
        this.cedar = require('@cedar-policy/cedar-wasm/nodejs');
        this.schema = JSON.parse(Tools.validateSchemaJson(this.cedar, config.schema)) as SchemaJson<string>;
        this.validateRequest = !!config.validateRequest;
        this.policies = {
            staticPolicies: config.staticPolicies,
        };
        const validationCall: ValidationCall = {
            schema: this.schema,
            validationSettings: {
                mode: 'strict'
            },
            policies: this.policies,
        };
        const validationAnswer = this.cedar.validate(validationCall);
        if (validationAnswer.type === 'failure') {
            const errors = validationAnswer.errors.map(({message}) => message).join('\n');
            throw new Error(`Policy validation failure: ${errors}`);
        }
        if (validationAnswer.type === 'success' && validationAnswer.validationErrors.length > 0) {
            const errors = validationAnswer.validationErrors.map(({policyId, error}) => `Error in policy ${policyId}: ${error.message}`).join('\n');
            throw new Error(`Policies didn't validate. Errors: ${errors}`)
        }
        if (validationAnswer.type === 'success' && validationAnswer.validationWarnings.length > 0) {
            const warnings = validationAnswer.validationWarnings.map(({policyId, error}) => `Warning in policy ${policyId}: ${error}`).join('\n');
            console.warn('Policies validated with warnings:\n', warnings);
        }
    }

    async isAuthorized(request: AuthorizationRequest, entities: Entity[]): Promise<AuthorizationResult> {
        const call = {
            principal: request.principal,
            action: request.action,
            resource: request.resource,
            context: request.context,
            policies: this.policies,
            entities: entities,
        } as AuthorizationCall;
        if (this.validateRequest) {
            Object.assign(call, {
                schema: this.schema,
                validateRequest: true,
            });
        }
        const result = this.cedar.isAuthorized(call);
        const resultType = result.type;
        switch(resultType) {
            case 'failure': {
                const errors = result.errors.map(({message}) => message).join('\n');
                return {
                    type: 'error',
                    message: errors,
                };
            }
            case 'success': {
                switch (result.response.decision) {
                    case 'deny': return { type: 'deny' };
                    case 'allow': return {
                        type: 'allow',
                        authorizerInfo: {
                            principalUid: {
                                ...request.principal,
                            },
                            determiningPolicies: result.response.diagnostics.reason,
                        },
                    };
                    default: assertUnreachable(result.response.decision);
                }
            }
            default: assertUnreachable(resultType);
        }
    }
}
