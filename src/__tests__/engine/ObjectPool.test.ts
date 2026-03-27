import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectPool, Poolable } from '../../engine/ObjectPool';

/** Test poolable object */
class TestObj implements Poolable {
  value = 0;
  resetCount = 0;

  reset(): void {
    this.value = 0;
    this.resetCount++;
  }
}

describe('ObjectPool', () => {
  let pool: ObjectPool<TestObj>;
  let factoryCallCount: number;

  beforeEach(() => {
    factoryCallCount = 0;
    pool = new ObjectPool<TestObj>(() => {
      factoryCallCount++;
      return new TestObj();
    }, 5);
  });

  it('pre-allocates the initial pool size', () => {
    expect(factoryCallCount).toBe(5);
    expect(pool.available).toBe(5);
    expect(pool.activeCount).toBe(0);
  });

  it('acquire returns an object and tracks it in active Set', () => {
    const obj = pool.acquire();
    expect(obj).toBeInstanceOf(TestObj);
    expect(pool.active.has(obj)).toBe(true);
    expect(pool.activeCount).toBe(1);
    expect(pool.available).toBe(4);
  });

  it('acquire reuses pre-allocated objects without calling factory', () => {
    pool.acquire();
    pool.acquire();
    pool.acquire();
    expect(factoryCallCount).toBe(5); // only initial allocation
    expect(pool.activeCount).toBe(3);
    expect(pool.available).toBe(2);
  });

  it('acquire creates new objects when free list is exhausted', () => {
    // Exhaust all 5
    for (let i = 0; i < 5; i++) pool.acquire();
    expect(pool.available).toBe(0);

    // Next acquire should create a new one
    const extra = pool.acquire();
    expect(factoryCallCount).toBe(6);
    expect(extra).toBeInstanceOf(TestObj);
    expect(pool.activeCount).toBe(6);
  });

  it('release calls reset() and moves object back to free list', () => {
    const obj = pool.acquire();
    obj.value = 42;

    pool.release(obj);

    expect(obj.resetCount).toBe(1);
    expect(obj.value).toBe(0);
    expect(pool.active.has(obj)).toBe(false);
    expect(pool.activeCount).toBe(0);
    expect(pool.available).toBe(5); // back to initial
  });

  it('release is idempotent — releasing same object twice is safe', () => {
    const obj = pool.acquire();
    pool.release(obj);
    pool.release(obj); // should be no-op

    expect(obj.resetCount).toBe(1); // only reset once
    expect(pool.available).toBe(5);
  });

  it('released objects are recycled on next acquire', () => {
    const obj1 = pool.acquire();
    obj1.value = 99;
    pool.release(obj1);

    const obj2 = pool.acquire();
    expect(obj2).toBe(obj1); // same reference
    expect(obj2.value).toBe(0); // reset was called
  });

  it('active is a Set with O(1) has/delete', () => {
    const objs: TestObj[] = [];
    for (let i = 0; i < 3; i++) objs.push(pool.acquire());

    // Verify it's a real Set
    expect(pool.active).toBeInstanceOf(Set);
    expect(pool.active.size).toBe(3);

    // O(1) removal — release middle element
    pool.release(objs[1]);
    expect(pool.active.has(objs[0])).toBe(true);
    expect(pool.active.has(objs[1])).toBe(false);
    expect(pool.active.has(objs[2])).toBe(true);
    expect(pool.active.size).toBe(2);
  });

  it('releaseAll returns all active objects to the free list', () => {
    const objs: TestObj[] = [];
    for (let i = 0; i < 4; i++) {
      const o = pool.acquire();
      o.value = i + 1;
      objs.push(o);
    }
    expect(pool.activeCount).toBe(4);

    pool.releaseAll();

    expect(pool.activeCount).toBe(0);
    expect(pool.available).toBe(5); // 1 original free + 4 released
    // All objects were reset
    for (const o of objs) {
      expect(o.value).toBe(0);
      expect(o.resetCount).toBe(1);
    }
  });

  it('pool works correctly across multiple acquire/release cycles', () => {
    // Simulate a game loop pattern: acquire some, use them, release some
    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();

    pool.release(a);
    pool.release(c);

    expect(pool.activeCount).toBe(1);
    expect(pool.available).toBe(4);

    // Re-acquire — should get recycled objects
    const d = pool.acquire();
    const e = pool.acquire();
    expect([a, c]).toContain(d); // recycled
    expect([a, c]).toContain(e);
    expect(pool.activeCount).toBe(3);
  });
});
