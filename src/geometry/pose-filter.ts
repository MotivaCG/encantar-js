/*
 * encantar.js
 * GPU-accelerated Augmented Reality for the web
 * Copyright (C) 2022-2023  Alexandre Martins <alemartf@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * pose-filter.ts
 * Smoothing filter for a pose
 */

import Speedy from 'speedy-vision';
import { SpeedyMatrix } from 'speedy-vision/types/core/speedy-matrix';
import { Quaternion } from './quaternion';
import { Vector3 } from './vector3';
import { IllegalArgumentError } from '../utils/errors';

/**
 * One Euro filter constants.
 * These are tuned for stable AR marker tracking:
 * - translation tends to be noisier on Z than on X/Y
 * - rotation tends to be jittery on yaw/pitch
 *
 * You can tweak these if you want a "snappier" or a "more stable" behavior.
 */

/** Numerical epsilon */
const EPS = 1e-8;

/** Default FPS used when we can't estimate dt */
const DEFAULT_DT = 1 / 60;

/** Clamp dt to avoid spikes when the tab is throttled */
const MIN_DT = 1 / 240;
const MAX_DT = 1 / 10;

/**
 * Translation One Euro filter params
 * minCutoff: lower -> more smoothing
 * beta: higher -> more responsiveness when moving
 */
const MIN_CUTOFF_T_LOWQ = 0.55;
const MIN_CUTOFF_T_HIGHQ = 1.25;
const BETA_T_LOWQ = 0.0;
const BETA_T_HIGHQ = 0.20;
const D_CUTOFF_T = 1.0;

/**
 * Rotation One Euro filter params
 * minCutoff: lower -> more smoothing
 * beta: higher -> more responsiveness when rotating
 */
const MIN_CUTOFF_R_LOWQ = 0.65;
const MIN_CUTOFF_R_HIGHQ = 1.60;
const BETA_R_LOWQ = 0.0;
const BETA_R_HIGHQ = 0.35;
const D_CUTOFF_R = 1.0;

/** Extra smoothing factor for Z translation (Z is usually the noisiest axis) */
const Z_SMOOTHING_FACTOR = 0.70;

/** Outlier gating (applied only when tracking quality is low) */
const LOW_QUALITY_THRESHOLD = 0.35;
const MAX_ANGLE_JUMP_DEG_LOWQ = 45;
const MAX_TRANSLATION_JUMP_RELZ_LOWQ = 0.60; // relative to |z|
const MAX_TRANSLATION_JUMP_ABS_LOWQ = 0.35;  // absolute (marker-size units-ish)

function clamp(x: number, a: number, b: number): number
{
    return x < a ? a : (x > b ? b : x);
}

function lerp(a: number, b: number, t: number): number
{
    return a + (b - a) * t;
}

/**
 * Compute the smoothing factor alpha for a given cutoff frequency.
 * @param cutoff cutoff frequency in Hz
 * @param dt timestep in seconds
 */
function alpha(cutoff: number, dt: number): number
{
    // tau = 1 / (2π f)
    const tau = 1.0 / (2.0 * Math.PI * Math.max(EPS, cutoff));
    return dt / (dt + tau);
}

/**
 * Low-pass filter: y = y + a (x - y)
 */
function lowpass(prev: number, x: number, a: number): number
{
    return prev + a * (x - prev);
}

function lowpassVec3(prev: Vector3, x: Vector3, a: number): Vector3
{
    return prev._set(
        lowpass(prev.x, x.x, a),
        lowpass(prev.y, x.y, a),
        lowpass(prev.z, x.z, a)
    );
}

/**
 * Ensure both quaternions are in the same hemisphere (avoid slerp flips)
 */
function ensureSameHemisphere(reference: Quaternion, q: Quaternion): Quaternion
{
    const dot = reference.x * q.x + reference.y * q.y + reference.z * q.z + reference.w * q.w;
    if(dot < 0)
        return q._set(-q.x, -q.y, -q.z, -q.w);
    return q;
}

/**
 * Spherical linear interpolation
 * @param a start quaternion (assumed normalized)
 * @param b end quaternion (assumed normalized, same hemisphere as a)
 * @param t interpolation factor [0,1]
 * @param out output quaternion
 */
function slerp(a: Quaternion, b: Quaternion, t: number, out: Quaternion): Quaternion
{
    // Robust slerp implementation
    let cosHalfTheta = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    cosHalfTheta = clamp(cosHalfTheta, -1, 1);

    // If the quaternions are very close, use lerp
    if(1 - Math.abs(cosHalfTheta) < 1e-5) {
        out._set(
            lerp(a.x, b.x, t),
            lerp(a.y, b.y, t),
            lerp(a.z, b.z, t),
            lerp(a.w, b.w, t)
        );
        return out._normalize();
    }

    const halfTheta = Math.acos(Math.abs(cosHalfTheta)); // dot >= 0 if hemisphere is enforced
    const sinHalfTheta = Math.sin(halfTheta);
    const w1 = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const w2 = Math.sin(t * halfTheta) / sinHalfTheta;

    out._set(
        a.x * w1 + b.x * w2,
        a.y * w1 + b.y * w2,
        a.z * w1 + b.z * w2,
        a.w * w1 + b.w * w2
    );

    return out._normalize();
}

/**
 * Small helper to compute the angular distance between two unit quaternions (in radians).
 */
function quaternionAngle(a: Quaternion, b: Quaternion): number
{
    // Assumes same hemisphere => dot in [0,1]
    const d = clamp(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w, 0, 1);
    return 2.0 * Math.acos(d);
}

/**
 * Smoothing filter for a pose (3x4 [R|t]).
 * This implementation replaces the previous fixed-window average by an adaptive One Euro filter.
 */
export class PoseFilter
{
    /** filtered rotation */
    private _rot: Quaternion;

    /** filtered translation */
    private _pos: Vector3;

    /** filtered translation derivative */
    private _dPos: Vector3;

    /** filtered angular speed (rad/s) */
    private _dRot: number;

    /** scratch */
    private _tmpQ: Quaternion;
    private _tmpT: Vector3;
    private _tmpD: Vector3;

    /** internal time tracking */
    private _lastTimestamp: number;

    /** has a valid state? */
    private _hasState: boolean;

    constructor()
    {
        this._rot = Quaternion.Identity();
        this._pos = Vector3.Zero();
        this._dPos = Vector3.Zero();
        this._dRot = 0;

        this._tmpQ = Quaternion.Identity();
        this._tmpT = Vector3.Zero();
        this._tmpD = Vector3.Zero();

        this._lastTimestamp = Number.NaN;
        this._hasState = false;
    }

    /**
     * Reset the filter
     */
    reset(): void
    {
        this._rot._copyFrom(Quaternion.Identity());
        this._pos._copyFrom(Vector3.Zero());
        this._dPos._copyFrom(Vector3.Zero());
        this._dRot = 0;
        this._lastTimestamp = Number.NaN;
        this._hasState = false;
    }

    /**
     * Feed the filter with a sample.
     * @param sample 3x4 [ R | t ] matrix
     * @param quality tracking quality score in [0,1]. Higher means more reliable measurements.
     * @param timestamp optional timestamp (ms). If omitted, uses performance.now()/Date.now().
     * @returns true on success; false if the sample was rejected as an outlier.
     */
    feed(sample: SpeedyMatrix, quality: number = 1, timestamp?: number): boolean
    {
        // sanity check
        if(sample.rows != 3 || sample.columns != 4)
            throw new IllegalArgumentError();

        const data = sample.read();

        // discard invalid samples (NaN/Inf anywhere in [R|t])
        for(let i = 0; i < 12; i++) {
            const v = data[i];
            if(!Number.isFinite(v))
                return false;
        }

        // time
        const now = (timestamp !== undefined) ? timestamp : ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
        let dt = DEFAULT_DT;
        if(Number.isFinite(this._lastTimestamp)) {
            dt = (now - this._lastTimestamp) * 0.001;
            dt = clamp(dt, MIN_DT, MAX_DT);
        }
        this._lastTimestamp = now;

        // extract sample rotation and translation
        const q = this._tmpQ._fromRotationMatrix(sample.block(0, 2, 0, 2));
        const t = this._tmpT._set(data[9], data[10], data[11]);

        // first sample
        if(!this._hasState) {
            this._rot._copyFrom(q)._normalize();
            this._pos._copyFrom(t);
            this._dPos._copyFrom(Vector3.Zero());
            this._dRot = 0;
            this._hasState = true;
            return true;
        }

        // normalize inputs + avoid quaternion flips
        q._normalize();
        ensureSameHemisphere(this._rot, q);

        // clamp quality
        const qlty = clamp(+quality || 0, 0, 1);

        // compute jump metrics (used for outlier gating)
        const angleJump = quaternionAngle(this._rot, q);
        const dx = t.x - this._pos.x;
        const dy = t.y - this._pos.y;
        const dz = t.z - this._pos.z;
        const translationJump = Math.sqrt(dx*dx + dy*dy + dz*dz);

        // reject very large jumps when quality is low
        if(qlty < LOW_QUALITY_THRESHOLD) {
            const z = Math.abs(this._pos.z) + EPS;
            const maxJump = Math.max(MAX_TRANSLATION_JUMP_ABS_LOWQ, MAX_TRANSLATION_JUMP_RELZ_LOWQ * z);
            const maxAngle = MAX_ANGLE_JUMP_DEG_LOWQ * Math.PI / 180.0;

            if(translationJump > maxJump && angleJump > maxAngle) {
                // keep previous state; don't contaminate the filter
                return false;
            }
        }

        // --------------------------
        // Translation (One Euro)
        // --------------------------
        // derivative (raw)
        const vel = this._tmpD._set(dx / dt, dy / dt, dz / dt);
        const aDPos = alpha(D_CUTOFF_T, dt);
        lowpassVec3(this._dPos, vel, aDPos);

        const speed = this._dPos.length();

        const minCutoffT = lerp(MIN_CUTOFF_T_LOWQ, MIN_CUTOFF_T_HIGHQ, qlty);
        const betaT = lerp(BETA_T_LOWQ, BETA_T_HIGHQ, qlty);

        const cutoffT = minCutoffT + betaT * speed;
        const cutoffTZ = Math.max(EPS, cutoffT * Z_SMOOTHING_FACTOR);

        const aPosXY = alpha(cutoffT, dt);
        const aPosZ = alpha(cutoffTZ, dt);

        this._pos._set(
            lowpass(this._pos.x, t.x, aPosXY),
            lowpass(this._pos.y, t.y, aPosXY),
            lowpass(this._pos.z, t.z, aPosZ)
        );

        // --------------------------
        // Rotation (One Euro)
        // --------------------------
        const rotSpeed = angleJump / dt;
        const aDRot = alpha(D_CUTOFF_R, dt);
        this._dRot = lowpass(this._dRot, rotSpeed, aDRot);

        const minCutoffR = lerp(MIN_CUTOFF_R_LOWQ, MIN_CUTOFF_R_HIGHQ, qlty);
        const betaR = lerp(BETA_R_LOWQ, BETA_R_HIGHQ, qlty);
        const cutoffR = minCutoffR + betaR * this._dRot;

        const aRot = alpha(cutoffR, dt);
        slerp(this._rot, q, aRot, this._rot);

        return true;
    }

    /**
     * Run the filter
     * @returns a 3x4 [ R | t ] matrix
     */
    output(): SpeedyMatrix
    {
        // If we have no valid samples yet, return identity pose
        if(!this._hasState) {
            const entries = Quaternion.Identity()._toRotationMatrix().read();
            entries.push(0, 0, 0);
            return Speedy.Matrix(3, 4, entries);
        }

        const entries = this._rot._toRotationMatrix().read();
        entries.push(this._pos.x, this._pos.y, this._pos.z);
        return Speedy.Matrix(3, 4, entries);
    }
}
