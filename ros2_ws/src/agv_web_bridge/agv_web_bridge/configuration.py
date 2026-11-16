"""Merge warehouse tuning into the installed Nav2 Humble defaults."""
from copy import deepcopy


def merge(base, changes):
    result = deepcopy(base)
    for key, value in changes.items():
        result[key] = merge(result[key], value) if isinstance(value, dict) and isinstance(result.get(key), dict) else deepcopy(value)
    return result


def wall_clock(config):
    if isinstance(config, dict):
        for key, value in config.items():
            if key == 'ros__parameters':
                value['use_sim_time'] = False
            wall_clock(value)
    return config
