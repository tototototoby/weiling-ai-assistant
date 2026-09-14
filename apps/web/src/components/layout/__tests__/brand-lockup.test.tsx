// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { BrandLockup } from '../brand-lockup';

it('renders the 微Link · 微灵 AI 助手 brand by default', () => {
  render(<BrandLockup />);

  expect(screen.getByText('微Link · 微灵 AI 助手')).toBeInTheDocument();
  expect(screen.getByAltText('微Link · 微灵 AI 助手 logo')).toHaveAttribute('src', '/brand/weiling-mark.png');
});
