const mockFindMany = jest.fn(async () => []);
jest.mock('@/lib/prisma', () => ({ prisma: { project: { findMany: mockFindMany } } }));

import { projectRepository } from '@/repositories/project.repository';

describe('push-webhook auto-deploy lookup', () => {
  it('skips projects whose owner is suspended', async () => {
    await projectRepository.findAutoDeployByBranch('main');
    expect(mockFindMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ autoDeploy: true, branch: 'main', user: { suspendedAt: null } }),
    });
  });
});
