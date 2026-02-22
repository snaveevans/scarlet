import { runShellCommand } from '../utils/shell.js';
import type {
  ValidationStep,
  ValidationResult,
  PipelineResult,
} from '../types.js';
import type { PRDMeta, Task } from '../prd/schemas.js';

export interface ValidatorOptions {
  steps: Array<'typecheck' | 'lint' | 'test' | 'build'>;
  timeoutMs: number;
  projectRoot: string;
}

export async function runValidationPipeline(
  prdMeta: PRDMeta,
  task: Task,
  options: ValidatorOptions,
): Promise<PipelineResult> {
  const { steps, timeoutMs, projectRoot } = options;
  const results: ValidationResult[] = [];
  const errors: string[] = [];

  const pipeline = buildPipeline(prdMeta, task, steps, timeoutMs);

  for (const step of pipeline) {
    const result = await runStep(step, projectRoot);
    results.push(result);

    if (!result.passed) {
      errors.push(`[${step.name}]\n${result.output}`);

      // Early exit: if typecheck fails, skip remaining steps
      if (step.name === 'typecheck' || step.required) {
        // Add skipped markers for remaining steps
        const remainingSteps = pipeline.slice(pipeline.indexOf(step) + 1);
        for (const remaining of remainingSteps) {
          results.push({
            step: remaining.name,
            passed: false,
            output: 'Skipped due to earlier failure',
            durationMs: 0,
          });
        }
        break;
      }
    }
  }

  return {
    allPassed: results.every((r) => r.passed),
    results,
    errors,
  };
}

function buildPipeline(
  meta: PRDMeta,
  task: Task,
  steps: ValidatorOptions['steps'],
  timeoutMs: number,
): ValidationStep[] {
  const pipeline: ValidationStep[] = [];

  if (steps.includes('typecheck')) {
    pipeline.push({
      name: 'typecheck',
      command: meta.typecheckCommand,
      required: true,
      timeoutMs,
    });
  }

  if (steps.includes('lint')) {
    pipeline.push({
      name: 'lint',
      command: meta.lintCommand,
      required: true,
      timeoutMs,
    });
  }

  if (steps.includes('test')) {
    if (task.tests.length > 0) {
      const testFiles = task.tests.join(' ');
      const framework = meta.testFramework;
      pipeline.push({
        name: 'test',
        command: `${framework} run ${testFiles}`,
        required: true,
        timeoutMs: timeoutMs * 2, // tests get more time
      });
    }
  }

  if (steps.includes('build')) {
    pipeline.push({
      name: 'build',
      command: meta.buildCommand,
      required: true,
      timeoutMs,
    });
  }

  return pipeline;
}

async function runStep(
  step: ValidationStep,
  cwd: string,
): Promise<ValidationResult> {
  const result = await runShellCommand(step.command, {
    cwd,
    timeoutMs: step.timeoutMs,
  });

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const passed = result.exitCode === 0 && !result.timedOut;

  if (result.timedOut) {
    return {
      step: step.name,
      passed: false,
      output: `Timed out after ${step.timeoutMs}ms\n${output}`,
      durationMs: result.durationMs,
    };
  }

  return {
    step: step.name,
    passed,
    output,
    durationMs: result.durationMs,
  };
}
