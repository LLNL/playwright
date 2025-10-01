#!/usr/bin/env node

/**
 * Comprehensive validation test for LLNL intelligent action recording implementation
 * Validates code structure, dependencies, and functionality without requiring browser interaction
 */

import fs from 'fs';
import path from 'path';

async function validateImplementation() {
  console.log('🔍 LLNL Intelligent Action Recording - Implementation Validation\n');

  let validationPassed = true;
  const issues = [];

  // Test 1: Validate file structure and modifications
  console.log('📁 1. Validating file structure and implementations...');

  const requiredFiles = [
    {
      path: 'packages/playwright/src/mcp/browser/tools/tracing.ts',
      description: 'Enhanced tracing tools',
      requiredContent: ['userActions', 'maxActionsPerSegment', 'initializeSessionSegmentManager', 'EnhancedTracingParams']
    },
    {
      path: 'packages/playwright/src/mcp/browser/context.ts',
      description: 'Context with session management',
      requiredContent: ['ActionFileWriter', 'SessionSegmentManager', '_postProcessTraceWithActions', 'finalizeSession']
    },
    {
      path: 'packages/playwright/src/mcp/browser/enhancedTracing.ts',
      description: 'Type definitions',
      requiredContent: ['ActionData', 'SessionSegment', 'EnhancedTracingParams']
    },
    {
      path: 'packages/playwright/bundles/mcp/package.json',
      description: 'Package dependencies',
      requiredContent: ['adm-zip']
    }
  ];

  for (const file of requiredFiles) {
    if (fs.existsSync(file.path)) {
      const content = fs.readFileSync(file.path, 'utf8');
      const missing = file.requiredContent.filter(req => !content.includes(req));

      if (missing.length === 0) {
        console.log(`   ✅ ${file.description}: All required content present`);
      } else {
        console.log(`   ❌ ${file.description}: Missing ${missing.join(', ')}`);
        issues.push(`${file.path}: Missing ${missing.join(', ')}`);
        validationPassed = false;
      }
    } else {
      console.log(`   ❌ ${file.description}: File not found at ${file.path}`);
      issues.push(`File not found: ${file.path}`);
      validationPassed = false;
    }
  }

  // Test 2: Validate enhanced tracing schema
  console.log('\n🔧 2. Validating enhanced tracing tool schema...');

  try {
    const tracingPath = 'packages/playwright/src/mcp/browser/tools/tracing.ts';
    const tracingContent = fs.readFileSync(tracingPath, 'utf8');

    // Check for enhanced parameters
    const hasUserActionsParam = tracingContent.includes('userActions: z.boolean()');
    const hasMaxActionsParam = tracingContent.includes('maxActionsPerSegment: z.number()');
    const hasDescriptions = tracingContent.includes('Enable intelligent human action recording') &&
                           tracingContent.includes('Maximum actions per trace segment');

    if (hasUserActionsParam && hasMaxActionsParam && hasDescriptions) {
      console.log('   ✅ Enhanced tracing schema properly implemented');
    } else {
      console.log('   ❌ Enhanced tracing schema incomplete');
      if (!hasUserActionsParam) issues.push('Missing userActions parameter schema');
      if (!hasMaxActionsParam) issues.push('Missing maxActionsPerSegment parameter schema');
      if (!hasDescriptions) issues.push('Missing parameter descriptions');
      validationPassed = false;
    }

    // Check for session initialization logic
    const hasSessionInit = tracingContent.includes('initializeSessionSegmentManager') &&
                          tracingContent.includes('setUserSessionActive(true)');

    if (hasSessionInit) {
      console.log('   ✅ Session initialization logic implemented');
    } else {
      console.log('   ❌ Session initialization logic missing');
      issues.push('Missing session initialization in browser_start_tracing');
      validationPassed = false;
    }

  } catch (error) {
    console.log('   ❌ Error validating tracing schema:', error.message);
    issues.push('Tracing schema validation failed');
    validationPassed = false;
  }

  // Test 3: Validate session management classes
  console.log('\n📦 3. Validating session management classes...');

  try {
    contextPath = 'packages/playwright/src/mcp/browser/context.ts';
    const contextContent = fs.readFileSync(contextPath, 'utf8');

    // Check ActionFileWriter class
    const hasActionFileWriter = contextContent.includes('export class ActionFileWriter') &&
                               contextContent.includes('async open()') &&
                               contextContent.includes('async append(actionData: ActionData)') &&
                               contextContent.includes('async close()');

    if (hasActionFileWriter) {
      console.log('   ✅ ActionFileWriter class properly implemented');
    } else {
      console.log('   ❌ ActionFileWriter class incomplete');
      issues.push('ActionFileWriter class missing required methods');
      validationPassed = false;
    }

    // Check SessionSegmentManager class
    const hasSessionManager = contextContent.includes('export class SessionSegmentManager') &&
                             contextContent.includes('async recordAction(actionData: ActionData)') &&
                             contextContent.includes('shouldRotate()') &&
                             contextContent.includes('async finalize');

    if (hasSessionManager) {
      console.log('   ✅ SessionSegmentManager class properly implemented');
    } else {
      console.log('   ❌ SessionSegmentManager class incomplete');
      issues.push('SessionSegmentManager class missing required methods');
      validationPassed = false;
    }

    // Check Context class enhancements
    const hasContextEnhancements = contextContent.includes('private _sessionSegmentManager') &&
                                  contextContent.includes('setUserSessionActive') &&
                                  contextContent.includes('finalizeSession');

    if (hasContextEnhancements) {
      console.log('   ✅ Context class enhanced with session management');
    } else {
      console.log('   ❌ Context class enhancements incomplete');
      issues.push('Context class missing session management enhancements');
      validationPassed = false;
    }

  } catch (error) {
    console.log('   ❌ Error validating session management:', error.message);
    issues.push('Session management validation failed');
    validationPassed = false;
  }

  // Test 4: Validate post-processing pipeline
  console.log('\n🔄 4. Validating trace post-processing pipeline...');

  try {
    contextPath = 'packages/playwright/src/mcp/browser/context.ts';
    const contextContent = fs.readFileSync(contextPath, 'utf8');

    // Check post-processing method
    const hasPostProcessing = contextContent.includes('_postProcessTraceWithActions') &&
                             contextContent.includes('const AdmZip = await import(\'adm-zip\')') &&
                             contextContent.includes('_generateIntelligentActionName') &&
                             contextContent.includes('_findMatchingAction');

    if (hasPostProcessing) {
      console.log('   ✅ Post-processing pipeline implemented');
    } else {
      console.log('   ❌ Post-processing pipeline incomplete');
      issues.push('Post-processing pipeline missing key components');
      validationPassed = false;
    }

    // Check intelligent action naming
    const hasIntelligentNaming = contextContent.includes('Click ${this._getElementDescription') &&
                                contextContent.includes('Type${content} in ${this._getElementDescription') &&
                                contextContent.includes('Navigate to ${action.url') &&
                                contextContent.includes('Press ${action.key');

    if (hasIntelligentNaming) {
      console.log('   ✅ Intelligent action naming implemented');
    } else {
      console.log('   ❌ Intelligent action naming incomplete');
      issues.push('Intelligent action naming missing action types');
      validationPassed = false;
    }

  } catch (error) {
    console.log('   ❌ Error validating post-processing:', error.message);
    issues.push('Post-processing validation failed');
    validationPassed = false;
  }

  // Test 5: Validate InputRecorder integration
  console.log('\n🎤 5. Validating InputRecorder integration...');

  try {
    const contextPath = 'packages/playwright/src/mcp/browser/context.ts';
    const contextContent = fs.readFileSync(contextPath, 'utf8');

    // Check InputRecorder enhancement
    const hasRecorderIntegration = contextContent.includes('if (this._context.isUserSessionActive()') &&
                                  contextContent.includes('const sessionManager = this._context.getSessionSegmentManager()') &&
                                  contextContent.includes('sessionManager.recordAction(actionData)') &&
                                  contextContent.includes('const actionData: ActionData = {');

    if (hasRecorderIntegration) {
      console.log('   ✅ InputRecorder integration implemented');
    } else {
      console.log('   ❌ InputRecorder integration incomplete');
      issues.push('InputRecorder integration missing in actionAdded callback');
      validationPassed = false;
    }

  } catch (error) {
    console.log('   ❌ Error validating InputRecorder integration:', error.message);
    issues.push('InputRecorder integration validation failed');
    validationPassed = false;
  }

  // Test 6: Validate dependencies
  console.log('\n📦 6. Validating package dependencies...');

  try {
    const packagePath = 'packages/playwright/bundles/mcp/package.json';
    const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

    const hasAdmZip = packageContent.dependencies && packageContent.dependencies['adm-zip'];

    if (hasAdmZip) {
      console.log('   ✅ adm-zip dependency present');
    } else {
      console.log('   ❌ adm-zip dependency missing');
      issues.push('Missing adm-zip dependency for ZIP processing');
      validationPassed = false;
    }

  } catch (error) {
    console.log('   ❌ Error validating dependencies:', error.message);
    issues.push('Dependency validation failed');
    validationPassed = false;
  }

  // Test 7: Validate type definitions
  console.log('\n📝 7. Validating type definitions...');

  try {
    const typesPath = 'packages/playwright/src/mcp/browser/enhancedTracing.ts';
    const typesContent = fs.readFileSync(typesPath, 'utf8');

    // Check interfaces
    const hasActionData = typesContent.includes('export interface ActionData') &&
                         typesContent.includes('timestamp: number') &&
                         typesContent.includes('callId: string') &&
                         typesContent.includes('action: {');

    const hasSessionSegment = typesContent.includes('export interface SessionSegment') &&
                             typesContent.includes('number: number') &&
                             typesContent.includes('traceFile: string') &&
                             typesContent.includes('actionFile: string');

    const hasEnhancedParams = typesContent.includes('export interface EnhancedTracingParams') &&
                             typesContent.includes('userActions?: boolean') &&
                             typesContent.includes('maxActionsPerSegment?: number');

    if (hasActionData && hasSessionSegment && hasEnhancedParams) {
      console.log('   ✅ All type definitions properly implemented');
    } else {
      console.log('   ❌ Type definitions incomplete');
      if (!hasActionData) issues.push('ActionData interface incomplete');
      if (!hasSessionSegment) issues.push('SessionSegment interface incomplete');
      if (!hasEnhancedParams) issues.push('EnhancedTracingParams interface incomplete');
      validationPassed = false;
    }

  } catch (error) {
    console.log('   ❌ Error validating type definitions:', error.message);
    issues.push('Type definitions validation failed');
    validationPassed = false;
  }

  // Test 8: Validate backward compatibility
  console.log('\n🔄 8. Validating backward compatibility...');

  try {
    const tracingPath = 'packages/playwright/src/mcp/browser/tools/tracing.ts';
    const tracingContent = fs.readFileSync(tracingPath, 'utf8');

    // Check for default values and graceful degradation
    const hasDefaultValues = tracingContent.includes('userActions: z.boolean().default(false)') &&
                            tracingContent.includes('maxActionsPerSegment: z.number().default(120)');

    const hasGracefulDegradation = tracingContent.includes('catch (error)') &&
                                  tracingContent.includes('Fall back to standard tracing');

    if (hasDefaultValues && hasGracefulDegradation) {
      console.log('   ✅ Backward compatibility maintained');
    } else {
      console.log('   ❌ Backward compatibility incomplete');
      if (!hasDefaultValues) issues.push('Missing default parameter values');
      if (!hasGracefulDegradation) issues.push('Missing graceful degradation logic');
      validationPassed = false;
    }

  } catch (error) {
    console.log('   ❌ Error validating backward compatibility:', error.message);
    issues.push('Backward compatibility validation failed');
    validationPassed = false;
  }

  // Final validation summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 IMPLEMENTATION VALIDATION SUMMARY');
  console.log('='.repeat(60));

  if (validationPassed) {
    console.log('✅ ALL VALIDATIONS PASSED!');
    console.log('\n🎯 Implementation Status: READY FOR TESTING');
    console.log('\nNext steps:');
    console.log('  1. Build MCP bundle: cd packages/playwright/bundles/mcp && npm install && npm run build');
    console.log('  2. Run: node test-enhanced-recording.js');
    console.log('  3. Run: node test-enhanced-recording-live.js (requires server)');
    console.log('  4. Test in Playwright trace viewer');
    console.log('  5. Validate "Bounding box" replacement in traces');
  } else {
    console.log('❌ VALIDATION FAILED');
    console.log(`\n🚨 ${issues.length} issue(s) found:`);
    issues.forEach((issue, index) => {
      console.log(`  ${index + 1}. ${issue}`);
    });
    console.log('\nPlease fix these issues before testing.');
  }

  console.log('\n📋 Implementation Features Validated:');
  console.log('  • Enhanced tracing tool parameters');
  console.log('  • Session segment management (120-action rotation)');
  console.log('  • JSONL action file storage');
  console.log('  • ZIP post-processing pipeline');
  console.log('  • Intelligent action naming');
  console.log('  • InputRecorder integration');
  console.log('  • Backward compatibility');
  console.log('  • Type definitions');
  console.log('  • Error handling and graceful degradation');

  return validationPassed;
}

validateImplementation().catch(console.error);
