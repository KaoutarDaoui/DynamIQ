from __future__ import annotations

# Agent 1 doesn't record exact window sizes, only wall area. So Agent 2 assumes
# windows make up this fraction of a room's *external* wall area (the rest is
# treated as solid opaque wall). 0.2 = a fifth of the outside wall is glass.
WINDOW_AREA_FRACTION = 0.2

# Solar Heat Gain Coefficient: of the sunlight energy that hits a window, what
# fraction actually turns into heat inside the room (0 = none gets through,
# 1 = all of it does). 0.7 is a typical value for an ordinary window.
SHGC = 0.7

# Assumed floor space per person, in square meters. Used to guess how many
# people are in a room from its area alone (area / 2.0 = occupant count),
# since there's no real headcount sensor in this system.
OCCUPANT_DENSITY_M2_PER_PERSON = 2.0

# The acceptable temperature range (Celsius) while a room is occupied. Below
# 20°C or above 26°C with people inside counts as an outright comfort
# violation, checked independently of the thermal model.
T_MIN_OCCUPIED_C = 20.0
T_MAX_OCCUPIED_C = 26.0

# A single out-of-band reading is often just weather catching up with HVAC --
# only escalate to a persisted, visible anomaly once it's stayed out of
# bounds for this many consecutive checks, which is a real "nobody is fixing
# this" signal rather than a momentary blip.
COMFORT_CONSECUTIVE_SAMPLES = 3

# The (much wider) acceptable range when nobody is in the room. Letting an
# empty room drift further from "comfortable" saves energy, since nobody is
# there to notice or care.
T_MIN_UNOCCUPIED_C = 16.0
T_MAX_UNOCCUPIED_C = 30.0

# Air Changes per Hour: how many times per hour the room's entire volume of
# air naturally leaks out through cracks/gaps and gets replaced by outside
# air (not from anyone opening a window — just an imperfectly sealed room).
# Used to calculate the unavoidable heat gain/loss from that constant leak.
INFILTRATION_ACH = 0.6

# U-value (W/m²·K) of the roof — how much heat leaks through per square meter
# per degree of temperature difference. Only applied to top-floor rooms,
# since only they have a roof exposed to the outside; other floors don't lose
# heat this way.
ROOF_U_VALUE = 2.0

# Local timezone, used for anything that depends on time-of-day: sun position
# for solar gain, and the offline carbon-intensity curve's daily peak hour.
TIMEZONE = 'Africa/Algiers'

# Multipliers applied to a room's base thermal capacitance depending on its
# construction. "Heavy" (concrete, brick, tile) holds heat much longer than
# "light" (drywall, thin partitions) — see MASS_FACTOR usage in zone_model.py.
MASS_FACTOR_HEAVY = 20.0
MASS_FACTOR_LIGHT = 8.0

# How much energy (Joules) it takes to raise 1 cubic meter of air by 1°C.
# A physical constant of air, used to convert the infiltration airflow (ACH)
# into an actual heat-loss wattage.
AIR_VOLUMETRIC_HEAT_CAPACITY = 1206.0

# The model's timestep, in seconds: 900s = 15 minutes. Every prediction, MPC
# plan, and sensor reading in this system operates on this 15-minute grid.
DT_SECONDS = 900.0

# How much heat (Watts) an average resting person's body gives off. Combined
# with the estimated occupant count, this becomes the "people heating" term
# in a room's energy balance.
OCCUPANT_SENSIBLE_HEAT_W = 75.0

# When fitting R and C from historical sensor data, don't just check if the
# model predicts one step (15 min) ahead correctly — check if it still holds
# up after this many steps compounded forward (16 steps = 4 hours). Fitting
# only 1 step ahead turned out to be numerically unstable (many very
# different R/C pairs look equally good over just 15 minutes).
CALIBRATION_FIT_HORIZON_STEPS = 16

# Minimum number of 15-minute sensor readings required before the system will
# even attempt to (re)calibrate a room. 4 * 24 * 3 = 3 full days of data.
# Less than this and calibration is skipped for that cycle, not attempted
# with too little information.
CALIBRATION_MIN_SAMPLES = 4 * 24 * 3

# If the real grid carbon-intensity API can't be reached, fall back to a
# fabricated day/night curve instead of guessing randomly: a baseline of
# 500 gCO2/kWh that swings by ±150 across the day, peaking at 8pm (hour 20) —
# roughly mimicking real grids, which get dirtier in the evening demand peak.
CARBON_OFFLINE_BASELINE_GCO2_PER_KWH = 500.0
CARBON_OFFLINE_AMPLITUDE_GCO2_PER_KWH = 150.0
CARBON_OFFLINE_PEAK_HOUR = 20.0

# Sanity bounds for a room's resistance R (K/W — how good its "insulating
# jacket" is). Any fitted or geometry-derived value outside this range is
# treated as physically implausible and rejected rather than trusted.
R_LUMPED_MIN_K_PER_W = 0.01
R_LUMPED_MAX_K_PER_W = 0.5

# Sanity bounds for a room's thermal capacitance C (J/K — how much heat it
# can absorb before its temperature actually moves). Same idea as the R
# bounds above: outside this range, something is wrong, reject it.
C_LUMPED_MIN_J_PER_K = 100000.0
C_LUMPED_MAX_J_PER_K = 50000000.0

# Sanity bounds for the time constant tau = R * C (seconds) — how long the
# room takes to respond to a change. Below the minimum, the room would react
# in seconds (impossible for a real room); above the maximum, it would take
# weeks (also impossible). Catches bad R/C combinations even when each value
# individually looks fine.
RC_TIME_CONSTANT_MIN_S = 1800.0
RC_TIME_CONSTANT_MAX_S = 360000.0

# Flat electricity price (currency per kWh) the MPC optimizer uses to weigh
# cost against comfort. Not time-of-day-varying in this system — there is no
# real-time pricing signal, just this one constant rate.
TARIFF_CURRENCY_PER_KWH = 4.67

# How much the optimizer values cutting carbon emissions relative to saving
# money. It's a multiplier on the carbon term in the objective — effectively
# "shifting 1 kg of CO2 is worth as much as this many currency units saved."
# Higher = the optimizer will spend more money to run at cleaner-grid times.
CARBON_WEIGHT_LAMBDA = 8.0

# The physically plausible range (Celsius) a real temperature sensor reading
# can fall in. Anything outside this in a normal building is not a real
# temperature — it means the sensor itself is broken, not that the room is
# actually that hot or cold.
SENSOR_VALID_MIN_C = 5.0
SENSOR_VALID_MAX_C = 45.0

# If the newest sensor reading is older than this many minutes, treat the
# sensor as dead/disconnected rather than trust an outdated number.
SENSOR_MAX_STALENESS_MINUTES = 30

# If a sensor reports the exact same value for this many hours straight,
# that's suspicious — a real temperature always drifts at least slightly.
# Flagged as a stuck/frozen sensor rather than a genuinely stable room.
SENSOR_STUCK_WINDOW_HOURS = 2.0

# How many consecutive readings must disagree with the model's prediction
# before a real anomaly is declared. Requiring several in a row (instead of
# just one) avoids over-reacting to a single noisy measurement.
ANOMALY_CONSECUTIVE_SAMPLES = 4

# An anomaly that's already open only counts as "resolved" once the error
# drops back under this fraction of the original threshold (0.5 = half).
# This gap between the "open" and "close" trigger points (hysteresis)
# stops the anomaly from flapping open/closed right at the boundary.
ANOMALY_CLEAR_FRACTION = 0.5

# No matter how accurately a room's model is calibrated, never set its
# anomaly-trigger threshold below this many degrees. Without this floor, a
# model that fits the training data extremely tightly could end up flagging
# every tiny, completely normal fluctuation as an "anomaly."
ANOMALY_THRESHOLD_FLOOR_C = 1.0

# How many days of recent history to look at when checking whether a room's
# calibration has gone stale ("drifted") since it was last fitted.
DRIFT_WINDOW_DAYS = 7

# If the model's average, sustained bias over that window exceeds this
# fraction of its own known error margin (RMSE from calibration), the system
# recommends recalibrating — the model is consistently wrong in one
# direction, not just noisy.
DRIFT_FRACTION_OF_RMSE = 0.5

# An artificially large cost the MPC optimizer pays for every degree it lets
# the room's temperature stray outside the comfort bounds. Set high enough
# that the optimizer will only ever violate comfort when it's truly
# physically impossible to avoid (e.g. equipment too small for the load),
# never as a way to save a little money.
COMFORT_SLACK_PENALTY = 10000.0
