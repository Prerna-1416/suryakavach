import { describe, it, expect } from 'vitest';
import {
  goesClass,
  goesClassColor,
  rLevelColor,
  riskLevel,
  riskColor,
  GOES_CLASSES,
} from '../lib/constants';

describe('goesClass', () => {
  it('returns A for flux below B threshold', () => {
    expect(goesClass(1e-8)).toBe('A');
    expect(goesClass(0)).toBe('A');
  });

  it('returns B for flux in B range', () => {
    expect(goesClass(1e-7)).toBe('B');
    expect(goesClass(5e-7)).toBe('B');
  });

  it('returns C for flux in C range', () => {
    expect(goesClass(1e-6)).toBe('C');
    expect(goesClass(5e-6)).toBe('C');
  });

  it('returns M for flux in M range', () => {
    expect(goesClass(1e-5)).toBe('M');
    expect(goesClass(5e-5)).toBe('M');
  });

  it('returns X for flux at or above X threshold', () => {
    expect(goesClass(1e-4)).toBe('X');
    expect(goesClass(1e-3)).toBe('X');
    expect(goesClass(1)).toBe('X');
  });
});

describe('goesClassColor', () => {
  it('maps flux to correct color', () => {
    expect(goesClassColor(1e-8)).toBe(GOES_CLASSES[0].color); // A
    expect(goesClassColor(1e-7)).toBe(GOES_CLASSES[1].color); // B
    expect(goesClassColor(1e-6)).toBe(GOES_CLASSES[2].color); // C
    expect(goesClassColor(1e-5)).toBe(GOES_CLASSES[3].color); // M
    expect(goesClassColor(1e-4)).toBe(GOES_CLASSES[4].color); // X
  });
});

describe('rLevelColor', () => {
  it('maps an API R-level to a presentation color', () => {
    expect(rLevelColor('R0')).toBe('#16a34a');
    expect(rLevelColor('R3')).toBe('#ea580c');
    expect(rLevelColor('R5')).toBe('#991b1b');
  });
});

describe('riskLevel', () => {
  it('returns low for p < 0.2', () => {
    expect(riskLevel(0)).toBe('low');
    expect(riskLevel(0.19)).toBe('low');
  });

  it('returns moderate for 0.2 <= p < 0.5', () => {
    expect(riskLevel(0.2)).toBe('moderate');
    expect(riskLevel(0.49)).toBe('moderate');
  });

  it('returns high for 0.5 <= p < 0.8', () => {
    expect(riskLevel(0.5)).toBe('high');
    expect(riskLevel(0.79)).toBe('high');
  });

  it('returns extreme for p >= 0.8', () => {
    expect(riskLevel(0.8)).toBe('extreme');
    expect(riskLevel(1)).toBe('extreme');
  });
});

describe('riskColor', () => {
  it('returns green for low risk', () => {
    expect(riskColor(0)).toBe('#16a34a');
  });

  it('returns orange for moderate risk', () => {
    expect(riskColor(0.3)).toBe('#d97706');
  });

  it('returns dark orange for high risk', () => {
    expect(riskColor(0.6)).toBe('#ea580c');
  });

  it('returns red for extreme risk', () => {
    expect(riskColor(0.9)).toBe('#dc2626');
  });
});
