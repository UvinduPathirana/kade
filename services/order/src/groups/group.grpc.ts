import { Inject, Injectable } from "@nestjs/common";
import {
  GroupOrderServiceService,
  type CloseGroupOrderRequest,
  type CloseGroupOrderResponse,
  type CreateGroupOrderRequest,
  type CreateGroupOrderResponse,
  type GetGroupOrderRequest,
  type GetGroupOrderResponse,
  type JoinGroupOrderRequest,
  type JoinGroupOrderResponse,
  type LeaveGroupOrderRequest,
  type LeaveGroupOrderResponse,
  type SetGroupMemberLinesRequest,
  type SetGroupMemberLinesResponse,
} from "@kade/proto/kade/order/v1/order_service";
import type { RequestContext } from "../platform/grpc/context.js";
import { invalidArgument } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { isStaff } from "../orders/access.js";
import { GroupService } from "./group.service.js";

/** kade.order.v1.GroupOrderService. */
@GrpcService(GroupOrderServiceService)
@Injectable()
export class GroupOrderGrpcService implements GrpcHandlers<GroupOrderServiceService> {
  constructor(@Inject(GroupService) private readonly groups: GroupService) {}

  async createGroupOrder(
    req: CreateGroupOrderRequest,
    ctx: RequestContext,
  ): Promise<CreateGroupOrderResponse> {
    const host = req.hostCustomerId || ctx.userId || "";
    return { group: await this.groups.create(ctx, { ...req, hostCustomerId: host }) };
  }

  async getGroupOrder(req: GetGroupOrderRequest): Promise<GetGroupOrderResponse> {
    if (!req.groupId && !req.shareToken) throw invalidArgument("GROUP_ID_REQUIRED", "Which group order?");
    return {
      group: await this.groups.getOpen({ id: req.groupId || undefined, token: req.shareToken || undefined }),
    };
  }

  async joinGroupOrder(req: JoinGroupOrderRequest, ctx: RequestContext): Promise<JoinGroupOrderResponse> {
    const { group, memberId } = await this.groups.join(
      ctx,
      req.shareToken,
      req.customerId || ctx.userId || "",
      req.name,
    );
    return { group, memberId };
  }

  async setGroupMemberLines(
    req: SetGroupMemberLinesRequest,
    ctx: RequestContext,
  ): Promise<SetGroupMemberLinesResponse> {
    return { group: await this.groups.setMemberLines(ctx, req.groupId, req.memberId, req.lines) };
  }

  async leaveGroupOrder(req: LeaveGroupOrderRequest, ctx: RequestContext): Promise<LeaveGroupOrderResponse> {
    return { group: await this.groups.leave(ctx, req.groupId, req.memberId) };
  }

  async closeGroupOrder(req: CloseGroupOrderRequest, ctx: RequestContext): Promise<CloseGroupOrderResponse> {
    return { group: await this.groups.close(ctx, req.groupId, ctx.userId, isStaff(ctx)) };
  }
}
