# Test fixture 3: Python runtime IndexError
# Note: Static type checkers/Pylance do not generally flag index-out-of-range errors on lists.
# This fixture is tested via "Bugify: Analyze Current Code".
numbers = [1, 2, 3]
print(numbers[10])
