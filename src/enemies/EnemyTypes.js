// Enemy archetypes — every one is a downloaded, pre-animated model (KayKit skeleton pack,
// Quaternius monsters) configured with its own weapons, stats, animations and attack set.
//
// attack.kind:
//   melee       — counterable (white indicator), standard parry
//   heavy       — counterable with a heavy counter (orange indicator), big damage
//   unblockable — cannot be countered (red indicator): dodge it
//   ranged      — projectile; counter near impact deflects it back (yellow indicator)

const KAY_ANIMS = {
  idle: 'Idle_Combat', walk: 'Walking_D_Skeletons', run: 'Running_C', strafeL: 'Running_Strafe_Left', strafeR: 'Running_Strafe_Right',
  back: 'Walking_Backwards', hit: ['Hit_A', 'Hit_B'], death: ['Death_C_Skeletons', 'Death_A', 'Death_B'], spawn: 'Spawn_Ground_Skeletons',
  down: 'Death_B', getup: 'Lie_StandUp', block: 'Block_Hit', air: 'Jump_Idle', taunt: 'Taunt', blocking: 'Blocking',
};
const QUAT_ANIMS = {
  idle: 'Idle', walk: 'Walk', run: 'Run', strafeL: 'Walk', strafeR: 'Walk', back: 'Walk', hit: ['HitReact'], death: ['Death'],
  spawn: null, down: 'Death', getup: 'Jump_Land', block: 'HitReact', air: 'Jump_Idle', taunt: 'Wave', blocking: 'Duck',
};

export const ENEMY_TYPES = {
  grunt: {
    name: 'Skeleton Minion', model: 'skMinion', rig: 'kaykit', anims: KAY_ANIMS, height: 2.2, radius: 0.7,
    hp: 46, speed: 4.6, runSpeed: 6.2, bony: true, score: 100,
    weapons: [{ key: 'skBlade', bone: 'handslot.r' }],
    attacks: [
      { anim: '1H_Melee_Attack_Chop', ts: 1.0, range: 2.6, arc: 90, dmg: 9, kind: 'melee', tele: 0.5, cd: 2.2, kb: 3 },
      { anim: '1H_Melee_Attack_Slice_Diagonal', ts: 1.0, range: 2.6, arc: 100, dmg: 9, kind: 'melee', tele: 0.5, cd: 2.2, kb: 3 },
    ],
  },
  runner: {
    name: 'Skeleton Rogue', model: 'skRogue', rig: 'kaykit', anims: { ...KAY_ANIMS, run: 'Running_A' }, height: 2.3, radius: 0.65,
    hp: 34, speed: 7.5, runSpeed: 10.5, bony: true, fast: true, score: 120,
    weapons: [{ key: 'skBlade', bone: 'handslot.r' }, { key: 'skBlade', bone: 'handslot.l' }],
    attacks: [
      { anim: 'Dualwield_Melee_Attack_Slice', ts: 1.35, range: 2.5, arc: 100, dmg: 6, kind: 'melee', tele: 0.36, cd: 1.6, kb: 2, combo: ['Dualwield_Melee_Attack_Chop', 'Dualwield_Melee_Attack_Stab'] },
      { anim: 'Dualwield_Melee_Attack_Stab', ts: 1.3, range: 2.8, arc: 70, dmg: 7, kind: 'melee', tele: 0.36, cd: 1.6, kb: 2, lunge: 5 },
    ],
  },
  mage: {
    name: 'Skeleton Mage', model: 'skMage', rig: 'kaykit', anims: KAY_ANIMS, height: 2.5, radius: 0.7,
    hp: 40, speed: 4.2, runSpeed: 5.5, bony: true, ranged: true, keepDist: [11, 17], score: 150,
    weapons: [{ key: 'skStaff', bone: 'handslot.r' }],
    attacks: [
      { anim: 'Spellcast_Shoot', ts: 1.0, range: 26, minRange: 4, arc: 30, dmg: 11, kind: 'ranged', tele: 0.6, cd: 3.4, proj: 'fireball' },
      { anim: '1H_Melee_Attack_Stab', ts: 1.0, range: 2.5, arc: 80, dmg: 7, kind: 'melee', tele: 0.45, cd: 2.4, kb: 3, close: true },
    ],
  },
  marksman: {
    name: 'Skeleton Marksman', model: 'skRogue', rig: 'kaykit', anims: KAY_ANIMS, height: 2.3, radius: 0.65,
    hp: 38, speed: 4.6, runSpeed: 6, bony: true, ranged: true, keepDist: [13, 20], score: 150, tint: [0.2, 0.25, 0.05],
    weapons: [{ key: 'skCrossbow', bone: 'handslot.r' }],
    attacks: [
      { anim: '2H_Ranged_Shoot', ts: 1.0, range: 30, minRange: 4, arc: 20, dmg: 10, kind: 'ranged', tele: 0.75, cd: 3.0, proj: 'bolt', aimAnim: '2H_Ranged_Aiming' },
      { anim: 'Unarmed_Melee_Attack_Kick', ts: 1.1, range: 2.4, arc: 80, dmg: 6, kind: 'melee', tele: 0.45, cd: 2.4, kb: 5, close: true },
    ],
  },
  brute: {
    name: 'Orc Brute', model: 'orc', rig: 'orc', anims: QUAT_ANIMS, height: 3.6, radius: 1.15,
    hp: 210, speed: 3.4, runSpeed: 4.8, heavyType: true, superArmor: true, poise: 60, score: 400,
    weakPoints: [{ bone: 'Torso', offset: [0, 0.1, -0.35], r: 0.55, mult: 2.2, back: true }],
    attacks: [
      { anim: 'Weapon', ts: 0.9, range: 3.6, arc: 110, dmg: 22, kind: 'heavy', tele: 0.7, cd: 2.8, kb: 7 },
      { anim: 'Punch', ts: 1.0, range: 3.0, arc: 90, dmg: 14, kind: 'melee', tele: 0.55, cd: 2.2, kb: 5 },
      { anim: 'Jump', ts: 0.9, imp: 0.62, range: 7, minRange: 3.5, arc: 360, dmg: 24, kind: 'unblockable', tele: 0.75, cd: 6, kb: 9, aoe: 4.2, leap: true, minWave: 8 },
    ],
  },
  elite: {
    name: 'Skeleton Champion', model: 'skWarrior', rig: 'kaykit', anims: KAY_ANIMS, height: 2.9, radius: 0.85,
    hp: 150, speed: 5, runSpeed: 7.4, bony: true, elite: true, shield: true, poise: 30, score: 500, tint: [0.35, 0.05, 0.4],
    weapons: [{ key: 'skAxe', bone: 'handslot.r' }, { key: 'skShield', bone: 'handslot.l' }],
    attacks: [
      { anim: '1H_Melee_Attack_Slice_Diagonal', ts: 1.15, range: 2.9, arc: 110, dmg: 13, kind: 'melee', tele: 0.42, cd: 2.0, kb: 4, combo: ['1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop'] },
      { anim: '1H_Melee_Attack_Jump_Chop', ts: 1.0, range: 8, minRange: 3.2, arc: 120, dmg: 20, kind: 'unblockable', tele: 0.6, cd: 5, kb: 8, leap: true },
      { anim: '2H_Melee_Attack_Spinning', ts: 1.1, range: 3.2, arc: 360, dmg: 16, kind: 'heavy', tele: 0.65, cd: 4.5, kb: 6 },
    ],
  },
  // ---- bosses (every fifth wave)
  giant: {
    name: 'The Colossus', model: 'giant', rig: 'giant', anims: QUAT_ANIMS, height: 7.2, radius: 2.0,
    hp: 1400, speed: 3.6, runSpeed: 6, heavyType: true, superArmor: true, boss: true, poise: 200, score: 5000,
    weakPoints: [{ bone: 'Head', offset: [0, 0.3, 0.3], r: 0.9, mult: 2.4 }],
    attacks: [
      { anim: 'Punch', ts: 0.85, range: 5.2, arc: 100, dmg: 26, kind: 'heavy', tele: 0.75, cd: 2.4, kb: 8 },
      { anim: 'Weapon', ts: 0.8, range: 5.8, arc: 220, dmg: 22, kind: 'unblockable', tele: 0.85, cd: 4.5, kb: 9 },
      { anim: 'Jump', ts: 0.85, imp: 0.62, range: 14, minRange: 5, arc: 360, dmg: 32, kind: 'unblockable', tele: 0.9, cd: 7, kb: 12, aoe: 7, leap: true },
    ],
  },
  demon: {
    name: 'Infernal Demon', model: 'demon', rig: 'demon', anims: QUAT_ANIMS, height: 6.2, radius: 1.8,
    hp: 1900, speed: 4.4, runSpeed: 7.5, heavyType: true, superArmor: true, boss: true, poise: 220, score: 8000, summons: 'grunt',
    weakPoints: [{ bone: 'Head', offset: [0, 0.25, 0.25], r: 0.8, mult: 2.4 }],
    attacks: [
      { anim: 'Weapon', ts: 0.9, range: 6.0, arc: 140, dmg: 26, kind: 'heavy', tele: 0.7, cd: 2.4, kb: 8 },
      { anim: 'Punch', ts: 1.0, range: 4.6, arc: 90, dmg: 18, kind: 'melee', tele: 0.55, cd: 2.0, kb: 6 },
      { anim: 'Wave', ts: 1.1, range: 30, minRange: 6, arc: 40, dmg: 16, kind: 'ranged', tele: 0.7, cd: 4.5, proj: 'fireball', burst: 3 },
      { anim: 'Jump', ts: 0.85, imp: 0.62, range: 14, minRange: 5, arc: 360, dmg: 30, kind: 'unblockable', tele: 0.9, cd: 7.5, kb: 12, aoe: 6.5, leap: true },
    ],
  },
  blueDemon: {
    name: 'Frost Fiend', model: 'blueDemon', rig: 'blueDemon', anims: { ...QUAT_ANIMS, run: 'Run2' }, height: 5.8, radius: 1.7,
    hp: 2300, speed: 5.4, runSpeed: 9, heavyType: true, superArmor: true, boss: true, poise: 240, score: 10000, summons: 'runner',
    weakPoints: [{ bone: 'Head', offset: [0, 0.25, 0.25], r: 0.8, mult: 2.4 }],
    attacks: [
      { anim: 'Punch', ts: 1.25, range: 4.6, arc: 100, dmg: 18, kind: 'melee', tele: 0.45, cd: 1.6, kb: 6, combo: ['Weapon'] },
      { anim: 'Weapon', ts: 1.0, range: 5.5, arc: 200, dmg: 24, kind: 'unblockable', tele: 0.75, cd: 3.6, kb: 9 },
      { anim: 'Wave', ts: 1.2, range: 30, minRange: 6, arc: 40, dmg: 15, kind: 'ranged', tele: 0.6, cd: 4, proj: 'fireball', burst: 5 },
      { anim: 'Jump', ts: 0.9, imp: 0.62, range: 15, minRange: 5, arc: 360, dmg: 30, kind: 'unblockable', tele: 0.8, cd: 6, kb: 12, aoe: 7, leap: true },
    ],
  },
};

export const BOSS_ORDER = ['giant', 'demon', 'blueDemon'];
