# Decision Summary: Orbit-State Data Format and Coordinate Frame

## 1. Purpose

The Communication Link Planner requires an orbit state from SatOS that can be used as the initial condition for Orekit propagation and for predicting future satellite-to-ground-station communication windows.

This document records the decision on:

1. the orbit-data representation provided by SatOS;
2. the coordinate frame of that data;
3. the recommended SatOS variables and metadata;
4. the role of other formats such as OMM, TLE, and OEM.

---

## 2. Final Decision

The canonical SatOS-to-planner interface shall provide a **time-tagged Cartesian position and velocity state** in the **GCRF** reference frame.

Because SatOS assigns one unit to each matrix variable, the state shall be stored as two separate variables:

| SatOS variable | Type | Shape | Unit | Coordinate frame |
|---|---|---:|---|---|
| `position_vector` | `MATRIX` | `1 × 3` | `m` | `GCRF` |
| `velocity_vector` | `MATRIX` | `1 × 3` | `m/s` | `GCRF` |

The two variables shall:

- have the same telemetry timestamp;
- refer to the same navigation solution;
- use the SatOS `validity` field;
- be retrieved through the generated SatOS Python SDK;
- be converted to an Orekit `PVCoordinates` object and used to create the initial orbit.

Ground-station coordinates shall be defined in **ITRF**. Orekit shall handle transformations between GCRF, ITRF, and the local topocentric ground-station frame during pass detection.

---

## 3. Why Use a Cartesian State Vector?

The required input to the propagation process is an instantaneous orbital state:

\[
\mathbf{x}(t_0)=
\begin{bmatrix}
x & y & z & v_x & v_y & v_z
\end{bmatrix}^{T}
\]

The state vector directly provides the satellite position and velocity at one epoch and is compatible with Orekit's `PVCoordinates` and `CartesianOrbit` classes.

### Advantages

A Cartesian state vector:

- is directly usable by numerical propagators;
- does not have the singularities of classical Keplerian elements for circular or equatorial orbits;
- represents the actual state at one specified epoch;
- can be checked and validated component by component;
- can be associated with a covariance matrix when uncertainty information is available.

Orekit's `CartesianOrbit` internally uses `x`, `y`, `z`, `xDot`, `yDot`, and `zDot`, so no preliminary element conversion is required.

---

## 4. Why Not Use OMM as the Primary Interface?

An **Orbit Mean-Elements Message (OMM)** contains mean orbital elements rather than an instantaneous Cartesian navigation state.

Typical OMM quantities include:

- mean motion;
- eccentricity;
- inclination;
- right ascension of the ascending node;
- argument of pericentre;
- mean anomaly;
- the associated mean-element theory.

OMM is suitable when an orbit product has deliberately been generated for a compatible analytical or semi-analytical propagation model, such as an SGP4-related workflow.

However, converting one measured Cartesian state into an OMM is not a simple formatting operation. It generally requires orbit determination or fitting and the generation of compatible mean elements.

SatOS does not inherently perform this process. Therefore, it should not be assumed that SatOS automatically converts received navigation telemetry into OMM.

### Decision

OMM may be supported as a **separate ground-generated orbit product**, but it shall not replace the canonical Cartesian state-vector interface.

---

## 5. Why Not Use TLE?

A Two-Line Element set is a compact mean-element representation designed for propagation with SGP4/SDP4.

It is not the natural representation of an onboard GNSS or navigation-filter solution. A TLE also cannot be generated correctly by simply converting one Cartesian state; it requires model-compatible fitting.

TLE may be retained as:

- a fallback orbit source;
- an external catalogue product;
- an input for a dedicated TLE/SGP4 propagation mode.

It should not be the primary SatOS telemetry interface for Orekit propagation based on a current position and velocity state.

---

## 6. Why Not Use OEM?

An **Orbit Ephemeris Message (OEM)** contains a sequence of time-tagged Cartesian states over an interval.

OEM is useful when another flight-dynamics system has already generated a complete ephemeris. For the present application, one current state is sufficient as the initial condition because the planner itself performs the future propagation.

OEM may therefore be accepted as an optional alternative input, but it is not required for the basic SatOS interface.

---

## 7. Why Use GCRF?

Orekit requires an orbit to be defined in a **pseudo-inertial frame**, because Newtonian orbit dynamics are formulated in such a frame.

GCRF is:

- Earth-centred;
- pseudo-inertial;
- directly supported by Orekit;
- the root of Orekit's Earth-frame transformation tree;
- suitable for defining and propagating an Earth-orbiting spacecraft state.

Orekit documentation states that only pseudo-inertial frames can be used to define orbits. GCRF is therefore a natural canonical frame for the initial Cartesian orbit.

### Orekit workflow

```text
SatOS position and velocity in GCRF
                ↓
Orekit PVCoordinates
                ↓
Orekit CartesianOrbit in GCRF
                ↓
Propagation
                ↓
Orekit transformation to ITRF/topocentric frame
                ↓
Elevation, azimuth, range, and pass events
```

---

## 8. Why Not Store the Canonical State in ECEF/ITRF?

ECEF/ITRF is ideal for the final ground-contact geometry because ground-station coordinates are fixed in the Earth-fixed frame.

However, ITRF rotates with Earth and is not pseudo-inertial. It is therefore not the appropriate frame in which to directly define an Orekit orbit.

If SatOS provided the state in ITRF, the planner would first need to transform the complete position-velocity state into GCRF before creating the orbit. The velocity transformation must include Earth-rotation effects.

### Decision

- **GCRF** is used for the canonical satellite state and propagation.
- **ITRF** is used for ground-station coordinates and Earth-fixed visibility geometry.
- Orekit performs the required transformations.

---

## 9. What If the Satellite Produces ECEF Navigation Data?

An onboard GNSS receiver may naturally output its navigation solution in an Earth-fixed frame.

### Preferred implementation

```text
Satellite state in ECEF/ITRF
          ↓
Gateway transforms complete PV state to GCRF
          ↓
SatOS stores canonical GCRF state
          ↓
Planner retrieves and propagates it
```

### Acceptable alternative

```text
SatOS stores native ECEF/ITRF state
          ↓
Planner reads explicit frame metadata
          ↓
Orekit transforms PVCoordinates to GCRF
          ↓
Planner creates the orbit
```

The second option is technically valid, but a fixed GCRF interface is preferred because it reduces frame-handling ambiguity.

---

## 10. Recommended SatOS Variables

### `position_vector`

```text
Name:        position_vector
Type:        MATRIX
Rows:        1
Columns:     3
Unit:        m
Contents:    [x, y, z]
Frame:       GCRF
```

Suggested description:

> Cartesian satellite position vector `[x, y, z]` in metres. Reference frame: GCRF. The SatOS telemetry timestamp is the navigation-state epoch. This variable must have the same timestamp as `velocity_vector`.

### `velocity_vector`

```text
Name:        velocity_vector
Type:        MATRIX
Rows:        1
Columns:     3
Unit:        m/s
Contents:    [vx, vy, vz]
Frame:       GCRF
```

Suggested description:

> Cartesian satellite velocity vector `[vx, vy, vz]` in metres per second. Reference frame: GCRF. The SatOS telemetry timestamp is the navigation-state epoch. This variable must have the same timestamp as `position_vector`.

### Optional variables

| Variable | Purpose |
|---|---|
| `navigation_status` | Detailed status such as `VALID`, `DEGRADED`, or `NO_FIX` |
| `state_covariance` | Optional `6 × 6` covariance matrix |
| `navigation_source` | GNSS, onboard propagator, or ground orbit determination |
| `reference_frame` | Needed only if the frame is not fixed by the interface definition |

A separate Boolean `navigation_valid` variable is unnecessary if it only duplicates the standard SatOS telemetry `validity` field.

---

## 11. Timestamp and Pairing Requirement

The state is valid only if position and velocity belong to the same epoch:

\[
\mathbf{r}(t_0)=
\begin{bmatrix}
x & y & z
\end{bmatrix},
\qquad
\mathbf{v}(t_0)=
\begin{bmatrix}
v_x & v_y & v_z
\end{bmatrix}
\]

The gateway shall post both variables with identical timestamps.

The planner shall combine samples only when:

- the timestamps are equal, or within a formally specified tolerance;
- both samples are valid;
- both use the expected frame;
- the state is not older than the permitted maximum age.

The SatOS timestamp shall represent the **navigation-state epoch**, not merely the ground reception time.

---

## 12. SatOS API Retrieval

SatOS supports matrix-valued telemetry, timestamps, validity metadata, and retrieval through the generated Python SDK.

Conceptual retrieval:

```python
from datetime import datetime, timedelta, timezone

from api_connect.satio_session import SatIOSession
from sat1_group1_mission.sat1_group1 import Sat1_Group1

satellite = Sat1_Group1()

end_time = datetime.now(tz=timezone.utc)
start_time = end_time - timedelta(hours=1)

with SatIOSession():
    positions = satellite.Var_position_vector.fetch(
        start_time=start_time,
        end_time=end_time,
    )

    velocities = satellite.Var_velocity_vector.fetch(
        start_time=start_time,
        end_time=end_time,
    )
```

The exact generated object path depends on the SAT.edit component tree.

`fetch()` retrieves telemetry already stored in SatOS. It does not directly request a new measurement from the spacecraft.

---

## 13. Frame Assignment

| Application element | Frame |
|---|---|
| Satellite state from SatOS | GCRF |
| Orekit orbit definition | GCRF |
| Orbit propagation | GCRF or another explicitly selected pseudo-inertial Orekit frame |
| Ground-station Earth model | ITRF |
| Ground-station local frame | Orekit `TopocentricFrame` |
| Pass detection | Topocentric elevation using Orekit frame transformations |
| TLE/SGP4 fallback | TEME internally, transformed by Orekit when required |

---

## 14. Decision Matrix

| Option | Suitable as canonical SatOS input? | Reason |
|---|---:|---|
| Cartesian position and velocity | **Yes** | Direct Orekit and propagation compatibility |
| OMM | No, optional separate product | Fitted mean elements tied to a mean-element theory |
| TLE | No, fallback only | SGP4-specific mean-element representation |
| OEM | Optional | Useful when an external complete ephemeris exists |
| Classical Keplerian elements | Not preferred | Requires conversion and may have singularities |
| ECEF/ITRF Cartesian state | Technically possible | Must be transformed before Orekit orbit definition |
| GCRF Cartesian state | **Preferred** | Pseudo-inertial and directly suitable for Orekit |

---

## 15. Interface Requirement

> SatOS shall provide the Communication Link Planner with a time-tagged Cartesian satellite position vector and velocity vector. The position shall be expressed in metres, the velocity in metres per second, and both shall be expressed in GCRF and shall refer to the same UTC-tagged epoch. The values shall be stored as separate `1 × 3` SatOS matrix telemetry variables because they use different physical units. The SatOS telemetry validity field shall indicate whether each sample is usable. The planner shall retrieve the latest complete, valid, and sufficiently recent state through the generated SatOS Python SDK and shall use it to initialize an Orekit orbit in GCRF. Ground-station coordinates shall be represented in ITRF, and Orekit shall perform the transformations required for topocentric pass detection. OMM, TLE, and OEM may be supported as additional orbit products, but shall not replace the canonical Cartesian state-vector interface.

---

## 16. Open Points

The final ICD should still define:

1. the source of the state vector;
2. the maximum permitted age of the state;
3. the timestamp matching tolerance;
4. whether a covariance matrix is available;
5. the chosen Orekit propagator and force models;
6. the ITRF realization and IERS conventions;
7. UTC-to-Orekit time handling and leap-second data;
8. whether OMM, TLE, or OEM fallback support is required.

---

## 17. Sources

1. **CCSDS 502.0-B-3 — Orbit Data Messages**, April 2023.  
   https://ccsds.org/Pubs/502x0b3e1.pdf

2. **Orekit — Orbits architecture**.  
   https://www.orekit.org/site-orekit-latest/architecture/orbits.html

3. **Orekit — Frames architecture**.  
   https://www.orekit.org/site-orekit-latest/architecture/frames.html

4. **Orekit — CartesianOrbit API**.  
   https://www.orekit.org/static/apidocs/org/orekit/orbits/CartesianOrbit.html

5. **Orekit — Frame API**.  
   https://www.orekit.org/static/apidocs/org/orekit/frames/Frame.html

6. **SatOS User Manual, version 0.0.14, May 2026**.  
   https://usermanual.satos-test.irs.uni-stuttgart.de/
