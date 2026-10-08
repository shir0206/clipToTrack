import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import Logo from './Logo';

describe('Logo', () => {
  it('renders brand color fallbacks when CSS variables are unavailable', () => {
    const markup = renderToStaticMarkup(
      createElement(Logo, { wordmark: false }),
    );

    expect(markup).toContain('var(--color-brand-blue, #2468f2)');
    expect(markup).toContain('var(--color-brand-pink, #f5388a)');
    expect(markup).toContain('var(--color-brand-orange, #ff7a1a)');
    expect(markup).toContain('var(--color-brand-white, #ffffff)');
  });
});
