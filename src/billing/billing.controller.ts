import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { InvoicePdfService } from '../invoices/invoice-pdf.service.js';
import { screenshotMulterOptions } from '../support/screenshot-upload.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { BillingService } from './billing.service.js';
import { BillingPaymentsQueryDto, CheckoutDto, CouponPreviewDto, PaymentDetailsDto, PlanChoiceDto } from './dto/checkout.dto.js';
import { PaymentGateways } from './gateways/payment-gateways.js';
import { PaymentConfirmationService } from './payment-confirmation.service.js';

const DETAILS_THROTTLE = { default: { limit: 10, ttl: 60 * 1000 } };

// The customer's plan and payments. A "View as customer" session reads
// only: UserAuthGuard refuses its writes.
@UseGuards(UserAuthGuard)
@Controller('api/billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly invoicePdf: InvoicePdfService,
  ) {}

  @Get()
  overview(@CurrentUser() user: RequestUser) {
    return this.billing.overview(user.id);
  }

  @Get('plans')
  plans(@CurrentUser() user: RequestUser) {
    return this.billing.plans(user.id);
  }

  @Get('payments')
  payments(@CurrentUser() user: RequestUser, @Query() query: BillingPaymentsQueryDto) {
    return this.billing.payments(user.id, query.page ?? 1, query.limit ?? 10);
  }

  @Get('payments/:id')
  payment(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.billing.payment(user.id, id);
  }

  // The customer's own invoice as a PDF; anyone else's is a 404.
  @Get('invoices/:id/pdf')
  @Header('Cache-Control', 'private, no-store')
  async invoicePdfFile(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const pdf = await this.invoicePdf.render(id, user.id);
    return new StreamableFile(pdf.data, { type: 'application/pdf', disposition: `attachment; filename="${pdf.fileName}"` });
  }

  @Post('trial')
  @HttpCode(200)
  trial(@CurrentUser() user: RequestUser, @Body() dto: PlanChoiceDto) {
    return this.billing.startTrial(user.id, dto.planId);
  }

  @Post('coupon-preview')
  @HttpCode(200)
  couponPreview(@CurrentUser() user: RequestUser, @Body() dto: CouponPreviewDto) {
    return this.billing.couponPreview(user.id, dto);
  }

  @Post('checkout')
  checkout(@CurrentUser() user: RequestUser, @Body() dto: CheckoutDto) {
    return this.billing.checkout(user.id, dto);
  }

  @Throttle(DETAILS_THROTTLE)
  @Patch('checkout/:paymentId')
  submitDetails(@CurrentUser() user: RequestUser, @Param('paymentId') paymentId: string, @Body() dto: PaymentDetailsDto) {
    return this.billing.submitDetails(user.id, paymentId, dto);
  }

  // The screenshot of the money sent: a JPEG, PNG or WEBP up to 5 MB.
  @Throttle(DETAILS_THROTTLE)
  @Post('checkout/:paymentId/proof')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('screenshot', screenshotMulterOptions))
  saveProof(@CurrentUser() user: RequestUser, @Param('paymentId') paymentId: string, @UploadedFile() screenshot?: Express.Multer.File) {
    return this.billing.saveProof(user.id, paymentId, screenshot);
  }

  @Delete('checkout/:paymentId/proof')
  removeProof(@CurrentUser() user: RequestUser, @Param('paymentId') paymentId: string) {
    return this.billing.removeProof(user.id, paymentId);
  }

  @Delete('checkout/:paymentId')
  cancelCheckout(@CurrentUser() user: RequestUser, @Param('paymentId') paymentId: string) {
    return this.billing.cancelCheckout(user.id, paymentId);
  }

  @Post('cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: RequestUser) {
    return this.billing.setCancelAtPeriodEnd(user.id, true);
  }

  @Post('resume')
  @HttpCode(200)
  resume(@CurrentUser() user: RequestUser) {
    return this.billing.setCancelAtPeriodEnd(user.id, false);
  }
}

// A payment gateway telling us a payment went through or failed. Only a
// configured real gateway has a webhook; every other name is a 404 (the
// manual way has none). The provider checks the request's signature.
@Controller('api/billing/webhooks')
export class BillingWebhooksController {
  constructor(
    private readonly gateways: PaymentGateways,
    private readonly confirmation: PaymentConfirmationService,
  ) {}

  @Post(':gateway')
  @HttpCode(200)
  async receive(@Param('gateway') gateway: string, @Req() req: Request) {
    const provider = this.gateways.webhookProvider(gateway);
    if (!provider?.verifyWebhook) throw new NotFoundException();
    const result = await provider.verifyWebhook(req);
    if (!result) throw new BadRequestException('Webhook not verified');
    try {
      if (result.status === 'SUCCESS') await this.confirmation.markPaid(result.paymentId, { reference: result.reference }, null);
      else await this.confirmation.markFailed(result.paymentId, 'gateway_failed', null);
    } catch (error) {
      // A gateway sends the same news more than once: an already settled
      // payment is not an error to it.
      if (!(error instanceof ConflictException)) throw error;
    }
    return { received: true };
  }
}
