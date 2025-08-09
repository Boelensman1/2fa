import { container } from '../internals'

type Dependency = symbol

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OmitFirstArg<F> = F extends (x: any, ...args: infer P) => infer R
  ? (...args: P) => R
  : never

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function bindDependencies<T extends Function>(
  func: T,
  dependencies: Dependency[],
) {
  const injections = dependencies.map((dependency: Dependency) => {
    if (typeof dependency === 'symbol') {
      return container.get(dependency)
    }
    return dependency
  })
  return func.bind(func, injections) as OmitFirstArg<T>
}

export default bindDependencies
