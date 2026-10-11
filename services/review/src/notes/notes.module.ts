import { Module } from "@nestjs/common";
import { NoteEventsConsumer } from "./note-events.consumer.js";
import { TemplateGrpcService } from "./notes.grpc.js";
import { NotesRepository } from "./notes.repository.js";

@Module({
  providers: [NotesRepository, TemplateGrpcService, NoteEventsConsumer],
})
export class NotesModule {}
