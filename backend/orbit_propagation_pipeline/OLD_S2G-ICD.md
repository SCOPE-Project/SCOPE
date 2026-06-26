# Comparison: ESA Standard vs. Our SatOS Format

## 1. Basic Idea

The ESA/ECSS approach describes a complete end-to-end communication chain between a satellite and a ground station. Our approach, by contrast, starts within the ground segment and uses SatOS as the central platform for planning, storage, and visualization.

| Aspect | ESA/ECSS Architecture | Our SatOS Architecture |
|---|---|---|
| Objective | Complete TM/TC communication between satellite and ground station | Planning and management of communication windows within the ground segment |
| Application protocol | ECSS PUS-C | SatOS API and SatOS data models |
| Packetization | CCSDS Space Packets | JSON objects via the SatOS REST API |
| Data link | CCSDS TM/TC Transfer Frames | Not part of the planning tool |
| Radio link | Synchronization, channel coding, modulation, and RF | Not part of the planning tool |
| Orbit data | CCSDS Orbit Data Messages, e.g. OMM | OMM preferred, TLE as fallback |
| Telemetry | PUS TM packets with mission-specific payload | Already decoded and typed SatOS variables |
| Telecommands | PUS TC packets with command verification | Generation of schedule activities, no direct TC execution |
| Visualization | Mission control system after TM decoding | SAT.view / Grafana |
| Operator role | Commanding, monitoring, and approval | Confirmation of the proposed communication-link schedule |

## 2. ESA/ECSS Reference Architecture

The complete ESA-oriented communication stack is:

```text
ECSS PUS-C
    ↓
CCSDS Space Packets
    ↓
CCSDS TM/TC Transfer Frames
    ↓
Synchronization and Channel Coding
    ↓
RF link between satellite and ground station
```

This architecture defines both the meaning of the TM/TC messages and the packetization, data link, error control, and radio transmission.

## 3. Simplification for Our Use Case

Our Communication Link Planning Tool does not implement the complete space-link stack. It operates above the existing ground-station and SatOS infrastructure.

```text
SatOS Satellite Schedule
SatOS Ground-Station Schedule
Orbit data: OMM or TLE
Ground-station coordinates
            ↓
Orbit propagation and pass calculation
            ↓
Filtering and trade-off
            ↓
Operator confirmation
            ↓
Satellite Communication Activity
Ground-Station Communication Activity
            ↓
SatOS Schedule
```

The tool therefore does not generate CCSDS or PUS packets. Instead, it creates two linked and conflict-free planning objects:

- one Communication Activity in the satellite schedule
- one Communication Activity in the ground-station schedule

Both activities receive a shared `link_id` and the same communication time interval.

## 4. Orbit Data

OMM is used as the preferred format for orbit propagation because it explicitly contains important metadata:

- epoch
- reference frame
- time system
- mean-element theory
- mean orbital elements

TLE remains available as a compatibility format. Both formats are converted into a common internal orbit model and propagated using SGP4.

## 5. SatOS Interface

Communication between the planning tool and SatOS takes place via HTTPS and JSON.

Typical inputs:

- satellite activities
- ground-station non-availability
- orbit data
- ground-station definitions

Typical outputs:

- Satellite Communication Activity
- Ground-Station Communication Activity
- planning-run status
- conflict and trade-off information

Telemetry data must already be decoded and mapped to typed SatOS variables before being transferred to SatOS.

## 6. Conclusion

The ESA/ECSS architecture remains the reference for real satellite-to-ground-station communication. Our format does not replace this architecture; instead, it abstracts it at ground-segment level.

For our current use case, the following is sufficient:

```text
OMM/TLE
+ SatOS REST API
+ JSON data objects
+ linked schedule activities
```

A later extension using PUS, CCSDS Space Packets, Transfer Frames, and RF communication is possible without changing the fundamental planning logic.

## 7. Example Satellite-to-Ground-Station Data Object

The following example shows a simplified telemetry packet sent by the satellite to the ground station. The structure is inspired by CCSDS Space Packets and ECSS PUS-C, but reduced to the fields required for this project.

```text
+----------------------+------------------------------+
| Field                | Example value                |
+----------------------+------------------------------+
| Packet version       | 0                            |
| Packet type          | TM                           |
| APID                 | 0x130                        |
| Sequence counter     | 4711                         |
| Service type         | 3                            |
| Service subtype      | 25                           |
| Onboard timestamp    | 2026-06-25T08:12:30.000Z     |
| Payload length       | 54 bytes                     |
| Payload              | Orbit and status data        |
| CRC-16               | 0x7A3C                       |
+----------------------+------------------------------+
```

For readability, the decoded payload could be represented as:

```json
{
  "packet_type": "TM",
  "apid": 304,
  "sequence_counter": 4711,
  "service_type": 3,
  "service_subtype": 25,
  "timestamp": "2026-06-25T08:12:30.000Z",
  "payload": {
    "satellite_id": "SAT-001",
    "position_m": {
      "x": 4215783.2,
      "y": 3864211.7,
      "z": 3521987.4
    },
    "velocity_mps": {
      "x": -5214.3,
      "y": 3842.6,
      "z": 4211.8
    },
    "reference_frame": "GCRF",
    "navigation_valid": true,
    "communication_mode": "NOMINAL"
  },
  "crc_valid": true
}
```

On the actual radio link, this object would normally be serialized as a compact binary packet rather than JSON. The ground-station gateway decodes the packet and maps the individual values to SatOS variables.

Example SatOS mapping:

```text
SAT-001.navigation.position_x_m
SAT-001.navigation.position_y_m
SAT-001.navigation.position_z_m
SAT-001.navigation.velocity_x_mps
SAT-001.navigation.velocity_y_mps
SAT-001.navigation.velocity_z_mps
SAT-001.navigation.reference_frame
SAT-001.navigation.valid
SAT-001.communication.mode
```

The resulting architecture is:

```text
Satellite binary TM packet
    ↓
Ground-station receiver
    ↓
CCSDS/PUS or mission-specific decoder
    ↓
Decoded and calibrated values
    ↓
SatOS telemetry variables
    ↓
SAT.view / Grafana
```
# Explanation of the Satellite-to-Ground-Station Telemetry Data Object

The following JSON object is a human-readable representation of a decoded telemetry packet:

```json
{
  "packet_type": "TM",
  "apid": 304,
  "sequence_counter": 4711,
  "service_type": 3,
  "service_subtype": 25,
  "timestamp": "2026-06-25T08:12:30.000Z",
  "payload": {
    "satellite_id": "SAT-001",
    "position_m": {
      "x": 4215783.2,
      "y": 3864211.7,
      "z": 3521987.4
    },
    "velocity_mps": {
      "x": -5214.3,
      "y": 3842.6,
      "z": 4211.8
    },
    "reference_frame": "GCRF",
    "navigation_valid": true,
    "communication_mode": "NOMINAL"
  },
  "crc_valid": true
}
```

The satellite would normally transmit the information as a compact binary packet rather than as JSON. The JSON representation shows how the packet may look after it has been decoded by the ground-station gateway.

## Top-Level Packet Fields

| Field | Meaning |
|---|---|
| `packet_type` | Defines the direction and general type of the packet. `TM` means telemetry transmitted from the satellite to the ground station. A command transmitted in the opposite direction would normally be identified as `TC`. |
| `apid` | The Application Process Identifier from the CCSDS Space Packet header. It identifies the onboard application or subsystem that generated the packet. The decimal value `304` corresponds to hexadecimal `0x130`. In this example, the APID is assigned to the navigation subsystem. |
| `sequence_counter` | A packet counter associated with the APID. It normally increases with every packet and allows the ground station to detect missing, duplicated, or incorrectly ordered packets. |
| `service_type` | Identifies the general ECSS PUS service. The value `3` represents the Housekeeping and Diagnostic Data Reporting Service. |
| `service_subtype` | Identifies the specific request or report within the selected PUS service. In this example, subtype `25` represents a particular housekeeping report. Its exact meaning must be defined in the mission-specific TM/TC packet dictionary. |
| `timestamp` | The time at which the telemetry values were generated or measured onboard. The value uses the ISO 8601 format. The suffix `Z` indicates UTC. |
| `payload` | Contains the mission-specific telemetry values transported by the packet. CCSDS and PUS define the surrounding packet structure, while the mission defines the fields within the payload. |
| `crc_valid` | Indicates whether the received packet passed the Cyclic Redundancy Check. `true` means that no transmission error was detected by the CRC check. This value is normally generated by the ground-station decoder and is not necessarily transmitted as an explicit JSON field. |

## Payload Fields

### `satellite_id`

```json
"satellite_id": "SAT-001"
```

This field identifies the spacecraft to which the data belongs.

It is useful when one ground system processes data from several satellites. In a complete CCSDS implementation, the spacecraft can also be identified at the transfer-frame level. Therefore, repeating the spacecraft identifier in every telemetry payload is optional.

### `position_m`

```json
"position_m": {
  "x": 4215783.2,
  "y": 3864211.7,
  "z": 3521987.4
}
```

This object contains the Cartesian satellite position vector:

\[
\mathbf{r} =
\begin{bmatrix}
x \\
y \\
z
\end{bmatrix}
\]

The suffix `_m` specifies that the components are given in metres.

For this example:

- \(x = 4\,215\,783.2\ \mathrm{m}\)
- \(y = 3\,864\,211.7\ \mathrm{m}\)
- \(z = 3\,521\,987.4\ \mathrm{m}\)

The numerical values only have an unambiguous physical meaning when the corresponding reference frame is known.

### `velocity_mps`

```json
"velocity_mps": {
  "x": -5214.3,
  "y": 3842.6,
  "z": 4211.8
}
```

This object contains the Cartesian velocity vector:

\[
\mathbf{v} =
\begin{bmatrix}
v_x \\
v_y \\
v_z
\end{bmatrix}
\]

The suffix `_mps` means metres per second.

The negative \(x\)-component means that the satellite is moving in the negative \(x\)-direction of the selected reference frame at the specified timestamp.

Together, position and velocity form the orbital state vector:

\[
\mathbf{x} =
\begin{bmatrix}
x & y & z & v_x & v_y & v_z
\end{bmatrix}^{T}
\]

### `reference_frame`

```json
"reference_frame": "GCRF"
```

This field defines the coordinate system in which the position and velocity vectors are expressed.

`GCRF` means **Geocentric Celestial Reference Frame**. It is an Earth-centred, approximately inertial reference frame commonly used for orbital state vectors.

Other possible reference frames include:

- `ITRF` or `ECEF`: Earth-fixed frames
- `TEME`: commonly used with TLE and SGP4
- `EME2000`: another commonly used inertial frame

The reference frame and timestamp must always be interpreted together. Without the reference frame, the position and velocity values are ambiguous.

### `navigation_valid`

```json
"navigation_valid": true
```

This field indicates whether the onboard navigation solution is considered valid.

A value of `false` could indicate:

- no valid GNSS solution
- a navigation filter that has not converged
- outdated navigation data
- a sensor fault
- a failed onboard consistency check

This field describes the validity of the telemetry content. It is independent of the CRC result.

For example:

```text
crc_valid = true
navigation_valid = false
```

This combination means that the packet was transmitted and received correctly, but the navigation solution contained in the packet is not considered trustworthy.

### `communication_mode`

```json
"communication_mode": "NOMINAL"
```

This field describes the current operating state of the satellite communication subsystem.

Possible mission-defined values could include:

```text
OFF
STANDBY
NOMINAL
HIGH_RATE
SAFE
FAULT
```

The exact enum values and their meanings must be documented in the mission-specific packet dictionary.

## Difference Between the Validity Fields

The object contains two different validity indicators:

| Field | Question answered |
|---|---|
| `crc_valid` | Was the packet received without a detected transmission error? |
| `navigation_valid` | Does the satellite consider the navigation solution trustworthy? |

A successful CRC check does not guarantee that the measured or calculated navigation data are physically valid.

## Corresponding Conceptual Packet Layout

The JSON object approximately represents the following packet structure:

```text
CCSDS Primary Header
├── Packet type: TM
├── APID: 0x130
├── Sequence counter: 4711
└── Packet length

PUS Secondary Header
├── Service type: 3
├── Service subtype: 25
└── Timestamp

Mission-Specific Payload
├── Satellite ID
├── Position vector
├── Velocity vector
├── Reference-frame ID
├── Navigation-valid flag
└── Communication mode

Packet Error-Control Field
└── CRC
```

The packet header, service information, and error-control field follow the CCSDS/PUS-oriented structure. Fields such as `position_m`, `navigation_valid`, and `communication_mode` are mission-specific and must be defined in the mission's TM/TC packet dictionary.


## ESA format as reference

```json
{
  "ccsds_primary_header": {
    "packet_version_number": 0,
    "packet_type": 0,
    "secondary_header_flag": 1,
    "apid": 304,
    "sequence_flags": 3,
    "packet_sequence_count": 4711,
    "packet_data_length": 67
  },

  "pus_tm_secondary_header": {
    "pus_version": 2,
    "spacecraft_time_reference_status": 0,
    "service_type": 3,
    "message_subtype": 25,
    "message_type_counter": 52,
    "destination_id": 1,
    "time": {
      "format": "CUC",
      "coarse_bytes": 4,
      "fine_bytes": 2,
      "decoded_utc": "2026-06-25T08:12:30.000Z"
    }
  },

  "source_data": {
    "housekeeping_structure_id": 1,
    "position_x_m": 4215783.2,
    "position_y_m": 3864211.7,
    "position_z_m": 3521987.4,
    "velocity_x_mps": -5214.3,
    "velocity_y_mps": 3842.6,
    "velocity_z_mps": 4211.8,
    "reference_frame_id": 1,
    "navigation_valid": 1,
    "communication_mode_id": 2
  },

  "packet_error_control": {
    "crc16_ccitt": "0x7A3C"
  }
}
```

Corresponding packet structure
```text
┌──────────────────────────────────────┐
│ CCSDS Packet Primary Header          │ 6 bytes
├──────────────────────────────────────┤
│ PUS-C TM Secondary Header            │ 13 bytes
├──────────────────────────────────────┤
│ PUS TM[3,25] Source Data             │ 53 bytes
├──────────────────────────────────────┤
│ Packet Error Control CRC             │ 2 bytes
└──────────────────────────────────────┘

Total: 74 bytes
```