# core/scheduling/conflict_builder.py
from collections import defaultdict, deque
from typing import Dict, List, Set, Tuple

from core.models.domain import (
    LinkBlock,
    TradeOffGroup,
    ConflictStructure,
)


def build_conflict_structure(eligible_links: List[LinkBlock]) -> ConflictStructure:
    """
    Constructs the mutual exclusion conflict graph and partitions it into
    connected components (TradeOffGroups with tradeoff_id).

    :param eligible_links: List of eligible LinkBlocks (is_eligible == True)
    :return: ConflictStructure containing adjacency list, trade-off groups, and lookups
    """
    links_by_id: Dict[str, LinkBlock] = {l.link_id: l for l in eligible_links}
    link_ids = list(links_by_id.keys())
    n = len(link_ids)

    adjacency_list: Dict[str, Set[str]] = {lid: set() for lid in link_ids}
    conflict_reasons: Dict[str, str] = {}

    # 1. Pairwise mutual exclusion evaluation
    for i in range(n):
        l1 = links_by_id[link_ids[i]]
        for j in range(i + 1, n):
            l2 = links_by_id[link_ids[j]]

            # Check temporal overlap
            if l1.start_time < l2.end_time and l1.end_time > l2.start_time:
                same_sat = (l1.satellite_name == l2.satellite_name)
                same_gs = (l1.groundstation_name == l2.groundstation_name)

                if same_sat or same_gs:
                    # Mutual exclusion edge exists
                    adjacency_list[l1.link_id].add(l2.link_id)
                    adjacency_list[l2.link_id].add(l1.link_id)

                    # Determine human-readable reason
                    if same_sat and same_gs:
                        reason = f"Satellite '{l1.satellite_name}' and Ground Station '{l1.groundstation_name}' overlap"
                    elif same_sat:
                        reason = f"Satellite '{l1.satellite_name}' simultaneous pass contention"
                    else:
                        reason = f"Ground Station '{l1.groundstation_name}' simultaneous tracking contention"

                    key_1 = f"{l1.link_id}:{l2.link_id}"
                    key_2 = f"{l2.link_id}:{l1.link_id}"
                    conflict_reasons[key_1] = reason
                    conflict_reasons[key_2] = reason

    # 2. Partition into Connected Components (TradeOffGroups) via BFS
    visited: Set[str] = set()
    trade_off_groups: Dict[str, TradeOffGroup] = {}
    link_to_group: Dict[str, str] = {}

    group_idx = 1
    # Sort link_ids by start_time to produce chronologically ordered group IDs
    sorted_link_ids = sorted(link_ids, key=lambda lid: links_by_id[lid].start_time)

    for start_lid in sorted_link_ids:
        if start_lid in visited:
            continue

        # Discover component via BFS
        component_ids: List[str] = []
        queue = deque([start_lid])
        visited.add(start_lid)

        while queue:
            curr_id = queue.popleft()
            component_ids.append(curr_id)

            for neighbor_id in adjacency_list.get(curr_id, set()):
                if neighbor_id not in visited:
                    visited.add(neighbor_id)
                    queue.append(neighbor_id)

        # Build TradeOffGroup for this component
        group_links = [links_by_id[lid] for lid in component_ids]
        tradeoff_id = f"TOG-{group_idx:04d}"
        group_idx += 1

        min_start = min(l.start_time for l in group_links)
        max_end = max(l.end_time for l in group_links)
        sats = sorted(list(set(l.satellite_name for l in group_links)))
        gss = sorted(list(set(l.groundstation_name for l in group_links)))

        group = TradeOffGroup(
            tradeoff_id=tradeoff_id,
            start_time=min_start,
            end_time=max_end,
            link_ids=component_ids,
            participating_satellites=sats,
            participating_groundstations=gss,
            is_trivial=(len(component_ids) == 1),
        )

        trade_off_groups[tradeoff_id] = group
        for lid in component_ids:
            link_to_group[lid] = tradeoff_id

    return ConflictStructure(
        adjacency_list=adjacency_list,
        conflict_reasons=conflict_reasons,
        trade_off_groups=trade_off_groups,
        link_to_group=link_to_group,
    )
