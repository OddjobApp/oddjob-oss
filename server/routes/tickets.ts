// @ts-nocheck

import { Router, type Request, type Response } from "express";
import { validateIdParam } from "@server/utils/api-utils.js";
import { eventStream } from "../domain/core/infrastructure/event-stream.service.js";
import { insertTicketSchema } from "@shared/schema/index.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";

import { ticketService } from "@domain/org/core/ticket.service.js";

const router = Router();

// GET /api/tickets - List all tickets
router.get("/", asyncHandler(async (req: Request, res: Response) => {
    const allTickets = await ticketService.list(100);
    res.json(allTickets);
}));

// GET /api/tickets/:id - Get single ticket
router.get("/:id", asyncHandler(async (req: Request, res: Response) => {
    const ticketId = validateIdParam(req.params.id);
    if (isNaN(ticketId)) {
        throw new BadRequestError("Invalid ticket ID");
    }

    const ticket = await ticketService.getById(ticketId);
    res.json(ticket);
}));

// POST /api/tickets - Create new ticket
router.post("/", asyncHandler(async (req: Request, res: Response) => {
    const result = insertTicketSchema.safeParse(req.body);
    if (!result.success) {
        throw new BadRequestError("Invalid input");
    }

    const newTicket = await ticketService.create(result.data);

    // EMIT EVENT: ticket.created
    await eventStream.publish("ticket.created", {
        ticket: newTicket,
    }, {
        source: "api"
    });

    res.status(201).json(newTicket);
}));

export default router;

