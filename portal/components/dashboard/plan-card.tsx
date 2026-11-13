/**
 * PlanCard — individual plan display for the paywall and plan comparison.
 *
 * Shows plan name, price, feature list, and CTA button. Supports a
 * "recommended" badge and "current plan" indicator. Features are passed
 * as an array of i18n-resolved strings so this component stays
 * translation-agnostic.
 */

import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface PlanCardProps {
  name: string;
  priceLabel: string;
  /** Crossed-out list price, when the plan is on sale. */
  originalPriceLabel?: string;
  /** Short sale badge, e.g. "30% off". */
  promoLabel?: string;
  features: string[];
  isRecommended?: boolean;
  isCurrent?: boolean;
  ctaLabel: string;
  onChoose: () => void;
  disabled?: boolean;
}

export function PlanCard({
  name,
  priceLabel,
  originalPriceLabel,
  promoLabel,
  features,
  isRecommended = false,
  isCurrent = false,
  ctaLabel,
  onChoose,
  disabled = false,
}: PlanCardProps) {
  return (
    <Card
      className={`relative flex flex-col ${ isRecommended ? 'border-success/30 border-success/30 shadow-md ring-1 ring-emerald-200 ring-success/30' : '' } ${isCurrent ? 'border-primary ring-1 ring-primary/20' : ''}`}
    >
      {isRecommended && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="bg-success dark:bg-success text-white hover:bg-success/90 dark:hover:bg-success">{ctaLabel === 'Choisir ce plan' || ctaLabel === 'اختر هذه الخطة' ? 'Recommandé' : 'Recommended'}</Badge>
        </div>
      )}
      <CardHeader className="text-center">
        <CardTitle className="text-lg">{name}</CardTitle>
        <p className="mt-2 text-3xl font-bold tracking-tight">{priceLabel}</p>
        {originalPriceLabel ? (
          <p className="mt-1 text-sm text-muted-foreground line-through tabular-nums">
            {originalPriceLabel}
          </p>
        ) : null}
        {promoLabel ? (
          <Badge className="mt-2 bg-warning/15 text-warning hover:bg-warning/20">
            {promoLabel}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="flex-1">
        <ul className="grid gap-2">
          {features.map((feat, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              <span>{feat}</span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        {isCurrent ? (
          <Button variant="outline" className="w-full" disabled>
            Current plan
          </Button>
        ) : (
          <Button
            variant={isRecommended ? 'default' : 'outline'}
            className="w-full"
            onClick={onChoose}
            disabled={disabled}
          >
            {ctaLabel}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}