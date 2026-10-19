/**
 * Ratings and reviews for one marketplace listing.
 *
 * The trigger shows the live average and count. Inside, anyone can read the
 * reviews; a member of an org that has the app installed can leave or edit their
 * own. Reviewer identities are never shown (the marketplace spans tenants).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Star, Trash2 } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@domain-ui/core/ui/components/ui/dialog';

export interface ReviewSummary {
    average: number;
    count: number;
}

interface Review {
    id: number;
    rating: number;
    comment: string | null;
    updatedAt: string;
    mine: boolean;
}

interface ReviewsResponse {
    summary: ReviewSummary;
    canReview: boolean;
    reviews: Review[];
}

function Stars({ value, size = 'w-3.5 h-3.5' }: { value: number; size?: string }) {
    return (
        <span className="inline-flex items-center gap-0.5" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((n) => (
                <Star
                    key={n}
                    className={cn(size, n <= Math.round(value) ? 'text-amber-500 fill-amber-500' : 'text-muted-foreground/40')}
                />
            ))}
        </span>
    );
}

export function reviewSummaryLabel(summary?: ReviewSummary): string {
    if (!summary || summary.count === 0) return 'No reviews yet';
    return `${summary.average.toFixed(1)} · ${summary.count} review${summary.count === 1 ? '' : 's'}`;
}

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
    return (
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Your rating">
            {[1, 2, 3, 4, 5].map((n) => (
                <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={value === n}
                    aria-label={`${n} star${n === 1 ? '' : 's'}`}
                    onClick={() => onChange(n)}
                    className="rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                    <Star className={cn('w-6 h-6', n <= value ? 'text-amber-500 fill-amber-500' : 'text-muted-foreground/40')} />
                </button>
            ))}
        </div>
    );
}

export function AppReviewsDialog({ appId, appName, summary }: { appId: number; appName: string; summary?: ReviewSummary }) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState('');

    const queryKey = [`/api/apps/${appId}/reviews`];
    const { data, isLoading } = useQuery<ReviewsResponse>({
        queryKey,
        queryFn: async () => (await apiRequest('GET', `/api/apps/${appId}/reviews`)).json(),
        enabled: open,
    });

    const mine = data?.reviews.find((r) => r.mine);
    useEffect(() => {
        if (!open) return;
        setRating(mine?.rating ?? 0);
        setComment(mine?.comment ?? '');
    }, [open, mine?.id, mine?.rating, mine?.comment]);

    const refresh = () => {
        queryClient.invalidateQueries({ queryKey });
        queryClient.invalidateQueries({ queryKey: ['/api/apps/market'] });
    };

    const save = useMutation({
        mutationFn: async () => (await apiRequest('PUT', `/api/apps/${appId}/reviews/mine`, { rating, comment: comment.trim() || null })).json(),
        onSuccess: () => {
            refresh();
            toast({ title: mine ? 'Review updated' : 'Review posted' });
        },
        onError: (err: any) => toast({ title: 'Could not save your review', description: err.message, variant: 'destructive' }),
    });

    const remove = useMutation({
        mutationFn: async () => (await apiRequest('DELETE', `/api/apps/${appId}/reviews/mine`)).json(),
        onSuccess: () => {
            refresh();
            setRating(0);
            setComment('');
            toast({ title: 'Review removed' });
        },
        onError: (err: any) => toast({ title: 'Could not remove your review', description: err.message, variant: 'destructive' }),
    });

    const shown = data?.summary ?? summary;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <button
                    type="button"
                    className="flex items-center gap-2 hover:text-foreground transition-colors"
                    aria-label={`Reviews for ${appName}: ${reviewSummaryLabel(shown)}`}
                >
                    <Stars value={shown?.average ?? 0} />
                    <span>{reviewSummaryLabel(shown)}</span>
                </button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Reviews · {appName}</DialogTitle>
                    <DialogDescription>
                        {shown && shown.count > 0
                            ? `Rated ${shown.average.toFixed(1)} out of 5 by ${shown.count} ${shown.count === 1 ? 'person' : 'people'} whose organizations use it.`
                            : 'Nobody has reviewed this app yet.'}
                    </DialogDescription>
                </DialogHeader>

                {isLoading ? (
                    <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                ) : (
                    <div className="space-y-5">
                        {data?.canReview ? (
                            <div className="space-y-3 rounded-lg border p-4">
                                <p className="text-sm font-medium">{mine ? 'Your review' : 'Rate this app'}</p>
                                <StarPicker value={rating} onChange={setRating} />
                                <Textarea
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                    placeholder="What worked, what didn't (optional)"
                                    maxLength={2000}
                                    rows={3}
                                />
                                <div className="flex gap-2">
                                    <Button size="sm" onClick={() => save.mutate()} disabled={rating === 0 || save.isPending}>
                                        {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                        {mine ? 'Update review' : 'Post review'}
                                    </Button>
                                    {mine && (
                                        <Button size="sm" variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending}>
                                            <Trash2 className="w-4 h-4 mr-2" /> Remove
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                Only members of an organization that has installed this app can review it.
                            </p>
                        )}

                        <ul className="space-y-3 max-h-72 overflow-y-auto">
                            {(data?.reviews ?? []).filter((r) => !r.mine).map((r) => (
                                <li key={r.id} className="border-b pb-3 last:border-0">
                                    <div className="flex items-center justify-between">
                                        <Stars value={r.rating} />
                                        <span className="text-xs text-muted-foreground">{new Date(r.updatedAt).toLocaleDateString()}</span>
                                    </div>
                                    {r.comment && <p className="text-sm mt-1.5 whitespace-pre-wrap">{r.comment}</p>}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
