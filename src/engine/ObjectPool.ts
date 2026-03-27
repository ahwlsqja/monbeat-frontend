/**
 * ObjectPool<T> — Generic typed object pool with Set-based active tracking.
 *
 * Uses a free list (array, O(1) pop/push) for recycling and a Set for
 * active objects (O(1) has/delete). Pool objects must implement reset().
 *
 * Avoids GC pressure by recycling pre-allocated objects instead of
 * creating/destroying them per frame.
 */

export interface Poolable {
  reset(): void;
}

export class ObjectPool<T extends Poolable> {
  private factory: () => T;
  private freeList: T[] = [];
  private activeSet: Set<T> = new Set();

  constructor(factory: () => T, initialSize: number) {
    this.factory = factory;

    // Pre-allocate initial pool
    for (let i = 0; i < initialSize; i++) {
      this.freeList.push(this.factory());
    }
  }

  /**
   * Acquire an object from the pool. Pops from the free list if available,
   * otherwise creates a new instance via the factory.
   */
  acquire(): T {
    const obj = this.freeList.length > 0
      ? this.freeList.pop()!
      : this.factory();

    this.activeSet.add(obj);
    return obj;
  }

  /**
   * Release an object back to the pool. Calls reset(), removes from
   * active Set, pushes onto free list.
   */
  release(obj: T): void {
    if (!this.activeSet.has(obj)) return; // already released or not from this pool
    this.activeSet.delete(obj);
    obj.reset();
    this.freeList.push(obj);
  }

  /**
   * Release all active objects back to the pool.
   */
  releaseAll(): void {
    for (const obj of this.activeSet) {
      obj.reset();
      this.freeList.push(obj);
    }
    this.activeSet.clear();
  }

  /** The Set of currently active (acquired) objects */
  get active(): Set<T> {
    return this.activeSet;
  }

  /** Number of available (free) objects */
  get available(): number {
    return this.freeList.length;
  }

  /** Number of currently active objects */
  get activeCount(): number {
    return this.activeSet.size;
  }
}
