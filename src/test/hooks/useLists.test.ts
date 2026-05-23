import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { makeMockClient } from '../helpers/mockSupabase';

vi.mock('../../lib/supabase', () => {
  const mock = makeMockClient({
    shopping_lists: [
      { id: 'L1', owner_id: 'u1', name: 'הרשימה שלי', is_default: true,  archived_at: null, created_at: 't', updated_at: 't' },
      { id: 'L2', owner_id: 'u1', name: 'שבועי',     is_default: false, archived_at: null, created_at: 't', updated_at: 't' },
      { id: 'L3', owner_id: 'u2', name: 'משפחתי',    is_default: false, archived_at: null, created_at: 't', updated_at: 't' },
    ],
    list_members: [
      { id: 'M1', list_id: 'L3', user_id: 'u1', invited_email: 'me@example.com', role: 'editor', invited_by: 'u2', invited_at: 't', joined_at: 't' },
    ],
  });
  return { supabase: mock };
});

beforeEach(() => vi.clearAllMocks());

describe('useLists', () => {
  it('partitions lists into owned vs shared', async () => {
    const { useLists } = await import('../../hooks/useLists');
    const { result } = renderHook(() => useLists());
    await waitFor(() => {
      expect(result.current.owned.map(l => l.id).sort()).toEqual(['L1','L2']);
      expect(result.current.shared.map(l => l.id)).toEqual(['L3']);
    });
  });
});
