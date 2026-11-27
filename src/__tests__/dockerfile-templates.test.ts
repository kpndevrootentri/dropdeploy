import { PROJECT_TYPES } from '@/types/project.types';
import {
  CONTAINER_PORTS,
  DOCKERFILE_TEMPLATES,
  djangoDockerfile,
  injectBuildArgs,
  isPublicBuildEnv,
  type DockerfileProjectType,
} from '@/services/docker/dockerfile.templates';
import { DockerService } from '@/services/docker/docker.service';

const dockerfiles: [string, string, DockerfileProjectType][] = [
  ...Object.entries(DOCKERFILE_TEMPLATES).map(([type, t]) => [type, t, type as DockerfileProjectType] as [string, string, DockerfileProjectType]),
  ['DJANGO (gunicorn)', djangoDockerfile({ settings: 'mysite.settings' }), 'DJANGO'],
];

it('has a template for every project type', () => {
  expect(Object.keys(DOCKERFILE_TEMPLATES)).toEqual(expect.arrayContaining([...PROJECT_TYPES]));
});

describe.each(dockerfiles)('%s', (_name, dockerfile, type) => {
  it('exposes the port the container is published on', () => {
    const exposed = [...dockerfile.matchAll(/^EXPOSE (\d+)$/gm)].map((m) => Number(m[1]));
    expect(exposed.at(-1)).toBe(CONTAINER_PORTS[type]);
  });

  it('runs its final stage as an unprivileged user, unless it is nginx', () => {
    const finalStage = dockerfile.split(/^FROM /m).at(-1)!;
    if (finalStage.startsWith('nginx:alpine')) return;
    // Docker runs as the last USER; root by name or uid 0 is still root.
    const lastUser = [...finalStage.matchAll(/^USER (\S+)$/gm)].at(-1)?.[1];
    expect(lastUser).toBeDefined();
    expect(lastUser).not.toMatch(/^(root|0)(:|$)/);
  });

  it('leaves no build-args placeholder behind', () => {
    expect(injectBuildArgs(dockerfile, [])).not.toContain('{{BUILD_ARGS}}');
    expect(injectBuildArgs(dockerfile, ['VITE_API'])).not.toContain('{{BUILD_ARGS}}');
  });
});

it('declares build args in the build stage, before the build runs', () => {
  const dockerfile = injectBuildArgs(DOCKERFILE_TEMPLATES.NEXTJS, ['NEXT_PUBLIC_A', 'NEXT_PUBLIC_B']);
  const args = 'ARG NEXT_PUBLIC_A\nENV NEXT_PUBLIC_A=$NEXT_PUBLIC_A\nARG NEXT_PUBLIC_B\nENV NEXT_PUBLIC_B=$NEXT_PUBLIC_B\n';
  expect(dockerfile).toContain(args);
  expect(dockerfile.indexOf(args)).toBeLessThan(dockerfile.indexOf('RUN npm run build'));
  expect(injectBuildArgs(DOCKERFILE_TEMPLATES.NEXTJS, [])).not.toContain('ARG ');
});

it.each([
  ['NEXTJS', 'NEXT_PUBLIC_API', true],
  ['NEXTJS', 'VITE_API', false],
  ['NEXTJS', 'DATABASE_URL', false],
  ['REACT', 'VITE_API', true],
  ['REACT', 'REACT_APP_API', true],
  ['VUE', 'VUE_APP_API', true],
  ['SVELTE', 'PUBLIC_API', true],
  ['NODEJS', 'NEXT_PUBLIC_API', false],
])('isPublicBuildEnv(%s, %s) is %s', (type, key, expected) => {
  expect(isPublicBuildEnv(type, key)).toBe(expected);
});

describe('getDockerfileForProject', () => {
  const docker = new DockerService({ socketPath: '/nonexistent.sock' });

  it('builds a static export for a Next.js project on static hosting', () => {
    expect(docker.getDockerfileForProject({ type: 'NEXTJS', useStaticHosting: true } as never))
      .toBe(injectBuildArgs(DOCKERFILE_TEMPLATES.NEXTJS_STATIC, []));
    expect(docker.getDockerfileForProject({ type: 'NEXTJS', useStaticHosting: false } as never))
      .toBe(injectBuildArgs(DOCKERFILE_TEMPLATES.NEXTJS, []));
  });

  it('falls back to the static template for an unknown type', () => {
    expect(docker.getDockerfileForProject({ type: 'COBOL' } as never)).toBe(DOCKERFILE_TEMPLATES.STATIC);
  });
});
