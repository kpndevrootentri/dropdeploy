import { handleApiError } from '@/lib/api-error';
import { loginSchema } from '@/validators/auth.validator';
import { createProjectSchema } from '@/validators/project.validator';

type Detail = { code: unknown; path: unknown; message: unknown };
type Body = { success: boolean; error: { code: string; message: string; details: Detail[] } };

/** The response handleApiError gives for the error that `parse()` throws. */
async function validationResponse(parse: () => unknown): Promise<{ status: number; body: Body }> {
  try {
    parse();
  } catch (error) {
    const res = handleApiError(error);
    return { status: res.status, body: await res.json() };
  }
  throw new Error('expected the input to be rejected');
}

describe('handleApiError for a validation error', () => {
  it('answers 400 with { success, error: { code, message, details[] } }', async () => {
    const { status, body } = await validationResponse(() => loginSchema.parse({}));
    expect(status).toBe(400);
    expect(Object.keys(body).sort()).toEqual(['error', 'success']);
    expect(body.success).toBe(false);
    expect(Object.keys(body.error).sort()).toEqual(['code', 'details', 'message']);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Validation failed');
  });

  it('lists one detail per problem, each with a code, a path and a message (the CLI prints the first message)', async () => {
    const { body } = await validationResponse(() => loginSchema.parse({ email: 'nope', password: '' }));
    expect(body.error.details.map((d) => d.path)).toEqual([['email'], ['password']]);
    for (const detail of body.error.details) {
      expect(typeof detail.code).toBe('string');
      expect(typeof detail.message).toBe('string');
      expect(detail.message).not.toBe('');
    }
  });

  it('keeps field problems before the repository check, with the check message as given', async () => {
    const { body } = await validationResponse(() =>
      createProjectSchema.parse({ name: 'ab', source: 'GITHUB', githubUrl: 'https://gitlab.com/group/repo' }),
    );
    expect(body.error.details.map((d) => d.path)).toEqual([['name'], ['githubUrl']]);
    expect(body.error.details[1]).toMatchObject({
      code: 'custom',
      message: 'Repository host (gitlab.com) does not match the selected source (GITHUB)',
    });
  });
});
