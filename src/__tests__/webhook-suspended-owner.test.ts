const mockFindMany = jest.fn(async () => []);
jest.mock('@/lib/prisma', () => ({ prisma: { project: { findMany: mockFindMany } } }));

import { projectRepository } from '@/repositories/project.repository';

describe('push-webhook auto-deploy lookup', () => {
  it('skips projects whose owner is suspended, and only matches the pushing provider', async () => {
    await projectRepository.findAutoDeployByBranch('main', 'GITLAB');
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ autoDeploy: true, source: 'GITLAB', branch: 'main', user: { suspendedAt: null } }),
    }));

    // GitLab looks up every branch of the repo: the token picks the project.
    await projectRepository.findAutoDeployByBranch(null, 'GITLAB');
    expect(mockFindMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { autoDeploy: true, source: 'GITLAB', branch: undefined, user: { suspendedAt: null } },
    }));
  });
});
