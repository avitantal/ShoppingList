import type { ShoppingList } from '../lib/supabase';
import { ShoppingListView } from './ShoppingListView';
import { ChecklistView } from './ChecklistView';
import { NoteView } from './NoteView';
import { LogView } from './LogView';

interface Props { list: ShoppingList; }

export function ActiveList({ list }: Props) {
  if (list.list_type === 'note')      return <NoteView list={list} />;
  if (list.list_type === 'checklist') return <ChecklistView list={list} />;
  if (list.list_type === 'log')       return <LogView list={list} />;
  return <ShoppingListView list={list} />;
}
