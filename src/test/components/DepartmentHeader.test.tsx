import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DepartmentHeader } from '../../components/DepartmentHeader';
import type { DepartmentMeta } from '../../lib/departments';

const dept: DepartmentMeta = { code: 'dairy', name: 'חלב וביצים', order: 3 };

describe('DepartmentHeader', () => {
  it('renders the department name', () => {
    render(
      <DepartmentHeader
        department={dept}
        items={[]}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('חלב וביצים')).toBeDefined();
  });

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(
      <DepartmentHeader
        department={dept}
        items={[]}
        collapsed={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('spreads dragHandleProps onto the header button', () => {
    const onPointerDown = vi.fn();
    render(
      <DepartmentHeader
        department={dept}
        items={[]}
        collapsed={false}
        onToggle={vi.fn()}
        dragHandleProps={{ onPointerDown }}
      />,
    );
    fireEvent.pointerDown(screen.getByRole('button'));
    expect(onPointerDown).toHaveBeenCalledTimes(1);
  });
});
