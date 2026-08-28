# Fixture file for the Python chunker plugin.

def add(a, b):
    total = a + b
    return total


class UserService:
    def __init__(self):
        self.users = []

    def add_user(self, name):
        self.users.append(name)
