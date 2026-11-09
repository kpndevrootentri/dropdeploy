jest.mock('@/services/project-access/project-access.service', () => ({ projectAccessService: {} }));

import { forEachItem } from '@/services/admin/admin-tools.service';

describe('forEachItem', () => {
  it('runs each id once, in order, and keeps going after a failure', async () => {
    const seen: string[] = [];
    const results = await forEachItem(['a', 'b', 'a', 'c'], async (id) => {
      seen.push(id);
      if (id === 'b') throw new Error('Project not found');
    });
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(results).toEqual([
      { id: 'a', ok: true },
      { id: 'b', ok: false, error: 'Project not found' },
      { id: 'c', ok: true },
    ]);
  });
});
