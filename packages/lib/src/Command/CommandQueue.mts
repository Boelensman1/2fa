import Command from './BaseCommand.mjs'

class CommandQueue {
  private queue: Command[] = []

  enqueue(command: Command): void {
    this.queue.push(command)
    this.queue.sort((a, b) => a.timestamp - b.timestamp)
  }

  dequeue(): Command | undefined {
    return this.queue.shift()
  }

  isEmpty(): boolean {
    return this.queue.length === 0
  }
}

export default CommandQueue
