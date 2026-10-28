import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

type Lock = {
  packages: Record<string, { version?: string; dev?: boolean }>;
};

describe('R1 production upload dependency inventory', () => {
  test('the packaged runtime lock excludes vulnerable copies and keeps Nest coherent', () => {
    // Exercise the existing production packaging plan, which strips dev roots
    // while preserving the exact lock/integrities used by npm ci --omit=dev.
    const load = createRequire(resolve('package.json'));
    const { plan } = load('../scripts/release-artifacts.cjs') as {
      plan: (component: string) => Map<string, Buffer>;
    };
    const artifact = plan('backend');
    const lock = JSON.parse(
      artifact.get('package-lock.json')!.toString(),
    ) as Lock;
    const sourceLock = JSON.parse(
      readFileSync(resolve('package-lock.json'), 'utf8'),
    ) as Lock;
    const runtime = Object.entries(lock.packages).filter(([, pkg]) => !pkg.dev);
    for (const [name, minimumMinor, minimumPatch] of [
      ['multer', 3, 0],
      ['proxy-addr', 0, 8],
    ] as const) {
      const copies = runtime.filter(([path]) =>
        path.endsWith(`node_modules/${name}`),
      );
      expect(copies).toHaveLength(1);
      for (const [path, pkg] of copies) {
        const [major, minor, patch] = pkg.version!.split('.').map(Number);
        expect(major).toBe(2);
        expect(
          minor > minimumMinor ||
            (minor === minimumMinor && patch >= minimumPatch),
        ).toBe(true);
        expect(pkg).toEqual(sourceLock.packages[path]);
      }
    }
    const versions = ['common', 'core', 'platform-express'].map(
      (name) => lock.packages[`node_modules/@nestjs/${name}`].version,
    );
    expect(new Set(versions).size).toBe(1);
    expect(versions[0]).toMatch(/^11\./);
    expect(lock.packages['node_modules/handlebars'].dev).toBe(true);
    expect(lock.packages['node_modules/ts-jest'].dev).toBe(true);
  });

  test('Nest and direct imports resolve the same patched runtime instances', () => {
    const direct = createRequire(resolve('package.json'));
    const nest = createRequire(direct.resolve('@nestjs/platform-express'));
    const express = createRequire(nest.resolve('express'));
    expect(nest.resolve('multer')).toBe(direct.resolve('multer'));
    const multer = direct('multer/package.json') as { version: string };
    const proxy = express('proxy-addr/package.json') as { version: string };
    expect(multer.version).toBe('2.4.0');
    expect(proxy.version).toBe('2.0.8');
  });
});
