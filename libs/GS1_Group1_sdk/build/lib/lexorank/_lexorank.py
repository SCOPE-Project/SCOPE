import math

alphabet_size = 26

smallest_char = "a"
biggest_char = "z"

smallest_ord = ord(smallest_char)
biggest_ord = ord(biggest_char)

middle_ord = smallest_ord + alphabet_size // 2
middle_char = chr(middle_ord)


def get_rank_between(first_rank: str, second_rank: str, overflow_add_size: int = 1) -> str:
    if any(char > biggest_char or char < smallest_char for char in first_rank):
        raise ValueError(f"Character out of range in first rank. Range is {smallest_char} and {biggest_char}")
    if any(char > biggest_char or char < smallest_char for char in second_rank):
        raise ValueError(f"Character out of range in second rank. Range is {smallest_char} and {biggest_char}")

    if first_rank > second_rank:
        raise ValueError(
            f"First position must be lower than second. Got firstRank {first_rank} and second rank {second_rank}"
        )

    # Make positions equal
    while len(first_rank) != len(second_rank):
        if len(first_rank) > len(second_rank):
            second_rank += smallest_char
        else:
            first_rank += smallest_char

    difference = get_distance(first_rank=first_rank, second_rank=second_rank)

    if difference == 0:
        raise ValueError("First rank and second rank cannot be equal")

    new_element = ""

    if difference == 1:
        # add middle char from alphabet
        add_str = [middle_char for _ in range(overflow_add_size)]
        new_element = first_rank + "".join(add_str)
    else:
        difference //= 2
        offset = 0
        for index in range(len(first_rank)):
            # formula: x = difference / (size^place - 1) % size;
            # i.e. difference = 110, size = 10, we want place 2 (middle),
            # then x = 100 / 10^(2 - 1) % 10 = 100 / 10 % 10 = 11 % 10 = 1
            diff_in_symbols = difference // math.pow(alphabet_size, index) % alphabet_size
            new_element_code = ord(first_rank[len(second_rank) - index - 1]) + diff_in_symbols + offset
            offset = 0
            # if newElement is greater than 'z'
            if new_element_code > biggest_ord:
                offset += 1
                new_element_code -= alphabet_size
            new_element += chr(int(new_element_code))

        new_element = "".join(reversed(new_element))

    return new_element


def get_new_rank(old_rank: str, distance: int = 8, min_overflow_add_size: int = 0) -> str:
    """
    :param old_rank: The rank to be taken as a base to calculate the distance from
    :param distance: The distance to add to old_rank
    :param min_overflow_add_size: The min amount of 'a' to add if an overflow occurs.
        An overflow is e.g. get_new_rank(old_rank='z, distance: int = 1, overflow_add_size: int = 3)
        This results in adding 'aaa' in the end and calculating a distance of 1.
        The result is 'z' + 1 = 'zaab'
    :return: new rank as string
    """
    if distance < 0:
        minimum = get_minimum(old_rank)
        dist_to_min = get_distance(minimum, old_rank)
        if dist_to_min <= 0:
            raise ValueError("No free values left")
        if dist_to_min < abs(distance):
            raise ValueError("Not enough distance to minimum")
    else:
        maximum = get_maximum(old_rank)
        # if old_rank == maximum:
        dist_to_max = get_distance(old_rank, maximum)
        if dist_to_max < distance:  # bigger container needed
            needed_container_size = max(
                min_overflow_add_size, math.ceil(math.log10(distance + 1) / math.log10(alphabet_size)), 1
            )
            old_rank += "".join(["a" for _ in range(needed_container_size)])
        if distance == 0:
            return old_rank

    diff_for_one_item = distance
    diff_for_symbols = []
    for rank in range(len(old_rank)):
        diff_for_symbols.append((diff_for_one_item // (alphabet_size**rank)) % alphabet_size)
    offset = 0
    new_element = ""
    suffix = ""
    for index in range(len(old_rank)):
        diff_in_symbols = diff_for_symbols[index]
        new_element_code = ord(old_rank[len(old_rank) - 1 - index]) + diff_in_symbols
        if offset != 0:
            new_element_code += 1
            offset = 0
        if new_element_code > biggest_ord:
            new_element_code -= alphabet_size
            offset += 1

        symbol = chr(new_element_code) + suffix
        new_element += symbol
    return "".join(reversed(new_element))


def get_distance(first_rank: str, second_rank: str) -> int:
    while len(first_rank) != len(second_rank):
        if len(first_rank) > len(second_rank):
            second_rank += smallest_char
        else:
            first_rank += smallest_char

    first_position_codes = [ord(char) for char in first_rank]
    second_position_codes = [ord(char) for char in second_rank]

    if first_rank == second_rank:
        return 0
    difference = 0

    for index in range(len(first_position_codes) - 1, -1, -1):
        # Codes of the elements of positions
        first_code = first_position_codes[index]
        second_code = second_position_codes[index]
        # i.e. ' a < b '
        if second_code < first_code:
            second_code += alphabet_size
            second_position_codes[index - 1] -= 1

        # formula: x = a * alphabet_size^0 + b * alphabet_size^1 + c * alphabet_size^2
        pow_res = math.pow(alphabet_size, len(first_rank) - index - 1)
        difference += (second_code - first_code) * pow_res

    return difference


def get_rank_between_index(index_a: int, index_b: int, all_ranks: list[str], overflow_add_size: int = 1) -> str:
    if index_a == index_b:
        raise ValueError("Indexes cannot be the same")

    if index_a < 0 or index_b < 0:
        raise ValueError("Indexes cannot be negative")

    if index_b - index_a > 1:
        raise ValueError("Indexes must next to each other and first index must be smaller than second one")

    return get_rank_between(
        first_rank=all_ranks[index_a], second_rank=all_ranks[index_b], overflow_add_size=overflow_add_size
    )


def get_maximum(rank: str) -> str:
    return "".join([biggest_char for _ in range(len(rank))])


def get_minimum(rank: str) -> str:
    return "".join([smallest_char for _ in range(len(rank))])
