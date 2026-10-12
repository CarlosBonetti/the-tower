/**
 * A thread that reads project dirs' git for the board: each message is a list of dirs, each reply their reads, settled
 * one by one. Started by `system.ts`.
 */
import { parentPort } from 'node:worker_threads'
import { readRepo } from './worktrees.ts'

parentPort!.on('message', async (dirs: string[]) => parentPort!.postMessage(await Promise.allSettled(dirs.map(readRepo))))
