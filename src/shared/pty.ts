import type * as pty from '@lydell/node-pty'

/** The terminal's `error` event, which the typings leave out. */
type ErrorEmitter = { on(event: 'error', listener: (err: Error) => void): void }

/**
 * node-pty rethrows a read error on its master socket (anything but EAGAIN and EIO) unless the terminal has an
 * `error` listener of its own, which takes the daemon owning it down. With one, the read error ends that PTY alone:
 * the child is killed and its `exit` follows as for any other end.
 */
export function endOnReadError(proc: pty.IPty, label: string) {
  ;(proc as pty.IPty & ErrorEmitter).on('error', (err) => {
    console.error(`${label}: its pty failed (${err.message}), ending it`)
    proc.kill()
  })
}
