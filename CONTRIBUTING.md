# Contributing to Oddjob

First off, thanks for taking the time to contribute!

All contributions are welcome, but as the project grows, it's important to keep the codebase consistent and easy to maintain. To that end, we've established a set of guidelines for contributing to the project.

## Architectural Patterns

We've adopted a controller/service pattern for our API routes. This pattern helps to separate the concerns of our application and makes the code more modular and easier to understand.

### Controllers

Controllers are responsible for handling incoming HTTP requests. They should be as "thin" as possible, meaning that they should not contain any business logic. Their sole responsibility is to:

1.  Parse and validate the incoming request.
2.  Call the appropriate service to handle the business logic.
3.  Format the response and send it back to the client.

### Services

Services are responsible for handling the business logic of the application. They should not have any knowledge of the HTTP layer. They should be pure functions that take in data, perform some business logic, and return the result.

### Example

Here's an example of how the controller/service pattern is used in our application:

**`server/routes/auth.controller.ts`**

```typescript
import { type Request, type Response } from "express";
import { AuthService } from "./auth.service.js";

export class AuthController {
    public static async login(req: Request, res: Response) {
        const { username, password } = req.body;
        const result = await AuthService.login(username, password);
        res.json(result);
    }
}
```

**`server/routes/auth.service.ts`**

```typescript
export class AuthService {
    public static async login(username, password) {
        // ... business logic ...
    }
}
```

By following this pattern, we can keep our codebase clean, organized, and easy to maintain.

## Getting Started

1.  Fork the repository.
2.  Create a new branch for your feature or bug fix.
3.  Make your changes.
4.  Write tests for your changes.
5.  Run the tests to make sure everything is working as expected.
6.  Submit a pull request.

We look forward to your contributions!
