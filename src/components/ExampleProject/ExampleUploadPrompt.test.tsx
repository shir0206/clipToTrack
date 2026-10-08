import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import ExampleUploadPrompt from './ExampleUploadPrompt';

describe('ExampleUploadPrompt', () => {
  it('asks where to add videos when the example project is open', () => {
    const markup = renderToStaticMarkup(
      createElement(ExampleUploadPrompt, { onChoose: vi.fn() }),
    );

    expect(markup).toContain('Where should your videos be added?');
    expect(markup).toContain(
      'You’re viewing the example project. To keep your videos separate, add them to a new project.',
    );
    expect(markup).toContain('New Project');
    expect(markup).toContain('Example Project');
    expect(markup).toContain('Cancel');
  });
});
