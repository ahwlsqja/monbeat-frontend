import { describe, it, expect } from 'vitest';
import { TxBlock } from '../../entities/TxBlock';
import { GameEventType, EVENT_COLORS } from '../../net/types';

describe('TxBlock', () => {
  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 600;

  describe('init()', () => {
    it('should position block in the correct lane', () => {
      const block = new TxBlock();
      block.init(0, CANVAS_WIDTH, CANVAS_HEIGHT);

      const laneWidth = CANVAS_WIDTH / 4; // 200
      expect(block.lane).toBe(0);
      expect(block.x).toBe(laneWidth * 0.2); // 40
      expect(block.width).toBe(laneWidth * 0.6); // 120
    });

    it('should position block in lane 2 correctly', () => {
      const block = new TxBlock();
      block.init(2, CANVAS_WIDTH, CANVAS_HEIGHT);

      const laneWidth = CANVAS_WIDTH / 4; // 200
      expect(block.lane).toBe(2);
      expect(block.x).toBe(2 * laneWidth + laneWidth * 0.2); // 440
    });

    it('should start above the viewport', () => {
      const block = new TxBlock();
      block.init(1, CANVAS_WIDTH, CANVAS_HEIGHT);

      expect(block.y).toBe(-block.height);
    });

    it('should set commitZoneY at 85% canvas height', () => {
      const block = new TxBlock();
      block.init(0, CANVAS_WIDTH, CANVAS_HEIGHT);

      expect(block.commitZoneY).toBe(CANVAS_HEIGHT * 0.85);
    });

    it('should set default speed, state, and TxCommit color', () => {
      const block = new TxBlock();
      block.init(3, CANVAS_WIDTH, CANVAS_HEIGHT);

      expect(block.speed).toBe(200);
      expect(block.state).toBe('falling');
      expect(block.color).toBe('#4ade80'); // EVENT_COLORS[TxCommit]
      expect(block.eventType).toBe(1); // GameEventType.TxCommit
    });
  });

  describe('update()', () => {
    it('should advance y by speed * dt while falling', () => {
      const block = new TxBlock();
      block.init(0, CANVAS_WIDTH, CANVAS_HEIGHT);
      const startY = block.y;

      block.update(0.1); // 0.1 seconds
      expect(block.y).toBe(startY + 200 * 0.1); // +20px
    });

    it('should not move when state is hit', () => {
      const block = new TxBlock();
      block.init(0, CANVAS_WIDTH, CANVAS_HEIGHT);
      block.state = 'hit';
      const startY = block.y;

      block.update(0.1);
      expect(block.y).toBe(startY);
    });

    it('should not move when state is despawning', () => {
      const block = new TxBlock();
      block.init(0, CANVAS_WIDTH, CANVAS_HEIGHT);
      block.state = 'despawning';
      const startY = block.y;

      block.update(0.1);
      expect(block.y).toBe(startY);
    });

    it('should accumulate position over multiple updates', () => {
      const block = new TxBlock();
      block.init(0, CANVAS_WIDTH, CANVAS_HEIGHT);
      const startY = block.y;

      block.update(0.1);
      block.update(0.1);
      block.update(0.1);
      expect(block.y).toBeCloseTo(startY + 200 * 0.3, 5);
    });
  });

  describe('isAtCommitZone()', () => {
    it('should return false when above commit zone', () => {
      const block = new TxBlock();
      block.init(0, CANVAS_WIDTH, CANVAS_HEIGHT);
      // y = -28, commitZoneY = 510
      expect(block.isAtCommitZone()).toBe(false);
    });

    it('should return true when at commit zone', () => {
      const block = new TxBlock();
      block.init(0, CANVAS_WIDTH, CANVAS_HEIGHT);
      block.y = block.commitZoneY;
      expect(block.isAtCommitZone()).toBe(true);
    });

    it('should return true when past commit zone', () => {
      const block = new TxBlock();
      block.init(0, CANVAS_WIDTH, CANVAS_HEIGHT);
      block.y = block.commitZoneY + 50;
      expect(block.isAtCommitZone()).toBe(true);
    });

    it('should detect commit zone after sufficient updates', () => {
      const block = new TxBlock();
      block.init(0, CANVAS_WIDTH, CANVAS_HEIGHT);
      // commitZoneY = 510, start at -28, speed = 200 px/s
      // Need (510 + 20) / 200 = 2.65 seconds
      for (let i = 0; i < 27; i++) {
        block.update(0.1); // 2.7 seconds
      }
      expect(block.isAtCommitZone()).toBe(true);
    });
  });

  describe('reset()', () => {
    it('should restore all properties to defaults', () => {
      const block = new TxBlock();
      block.init(2, CANVAS_WIDTH, CANVAS_HEIGHT);
      block.update(1.0); // move it
      block.state = 'hit';

      block.reset();

      expect(block.x).toBe(0);
      expect(block.y).toBe(0);
      expect(block.width).toBe(0);
      expect(block.height).toBe(28);
      expect(block.lane).toBe(0);
      expect(block.state).toBe('falling');
      expect(block.color).toBe('#4ade80'); // EVENT_COLORS[TxCommit]
      expect(block.speed).toBe(200);
      expect(block.commitZoneY).toBe(0);
    });

    it('should allow re-init after reset', () => {
      const block = new TxBlock();
      block.init(0, CANVAS_WIDTH, CANVAS_HEIGHT);
      block.update(1.0);

      block.reset();
      block.init(3, 1000, 800);

      const laneWidth = 1000 / 4;
      expect(block.lane).toBe(3);
      expect(block.x).toBe(3 * laneWidth + laneWidth * 0.2);
      expect(block.y).toBe(-28);
      expect(block.commitZoneY).toBe(800 * 0.85);
    });
  });

  describe('Poolable interface', () => {
    it('should have a reset method', () => {
      const block = new TxBlock();
      expect(typeof block.reset).toBe('function');
    });
  });

  describe('eventType color mapping', () => {
    it('should default to TxCommit green when no eventType passed', () => {
      const block = new TxBlock();
      block.init(0, CANVAS_WIDTH, CANVAS_HEIGHT);
      expect(block.eventType).toBe(GameEventType.TxCommit);
      expect(block.color).toBe(EVENT_COLORS[GameEventType.TxCommit]);
    });

    it.each([
      [GameEventType.TxCommit, EVENT_COLORS[GameEventType.TxCommit]],
      [GameEventType.Conflict, EVENT_COLORS[GameEventType.Conflict]],
      [GameEventType.ReExecution, EVENT_COLORS[GameEventType.ReExecution]],
      [GameEventType.ReExecutionResolved, EVENT_COLORS[GameEventType.ReExecutionResolved]],
      [GameEventType.BlockComplete, EVENT_COLORS[GameEventType.BlockComplete]],
    ] as const)('should set color for eventType %i', (eventType, expectedColor) => {
      const block = new TxBlock();
      block.init(1, CANVAS_WIDTH, CANVAS_HEIGHT, eventType);
      expect(block.eventType).toBe(eventType);
      expect(block.color).toBe(expectedColor);
    });

    it('should reset eventType to TxCommit', () => {
      const block = new TxBlock();
      block.init(0, CANVAS_WIDTH, CANVAS_HEIGHT, GameEventType.Conflict);
      expect(block.eventType).toBe(GameEventType.Conflict);
      expect(block.color).toBe(EVENT_COLORS[GameEventType.Conflict]);

      block.reset();
      expect(block.eventType).toBe(GameEventType.TxCommit);
      expect(block.color).toBe(EVENT_COLORS[GameEventType.TxCommit]);
    });

    it('should re-init with a different eventType after reset', () => {
      const block = new TxBlock();
      block.init(0, CANVAS_WIDTH, CANVAS_HEIGHT, GameEventType.TxCommit);
      block.reset();
      block.init(2, CANVAS_WIDTH, CANVAS_HEIGHT, GameEventType.ReExecution);
      expect(block.eventType).toBe(GameEventType.ReExecution);
      expect(block.color).toBe(EVENT_COLORS[GameEventType.ReExecution]);
    });
  });
});
