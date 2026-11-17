import { useSyncExternalStore } from 'react'

export interface AddRequest { open: boolean; text?: string; url?: string; mediaCount?: number; autoRun?: boolean }
let state: AddRequest = { open: false }
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
export const openAdd = (p: Omit<AddRequest, 'open'> = {}) => { state = { open: true, ...p }; emit() }
export const closeAdd = () => { state = { open: false }; emit() }
export const useAddRequest = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => state, () => state)
