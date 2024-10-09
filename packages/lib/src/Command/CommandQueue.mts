import Command from './BaseCommand.mjs'

/**
 * Represents a queue of commands with timestamp-based sorting.
 */
class CommandQueue {
  private queue: Command[] = []

  /**
   * Adds a command to the queue and sorts it based on timestamp.
   * @param command - The command to be added to the queue.
   */
  enqueue(command: Command): void {
    this.queue.push(command)
    this.queue.sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * Removes and returns the first command from the queue.
   * @returns The first command in the queue, or undefined if the queue is empty.
   */
  dequeue(): Command | undefined {
    return this.queue.shift()
  }

  /**
   * Checks if the queue is empty.
   * @returns True if the queue is empty, false otherwise.
   */
  isEmpty(): boolean {
    return this.queue.length === 0
  }
}

export default CommandQueue
