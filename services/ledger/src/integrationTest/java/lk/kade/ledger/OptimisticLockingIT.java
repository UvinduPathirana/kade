package lk.kade.ledger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import lk.kade.ledger.db.OptimisticRetry;
import lk.kade.ledger.error.OptimisticLockException;
import lk.kade.ledger.money.Money;
import lk.kade.ledger.note.NoteService;
import lk.kade.ledger.note.NoteTotals;
import lk.kade.ledger.note.NoteTotalsRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class OptimisticLockingIT extends IntegrationTestBase {

    @Autowired NoteTotalsRepository totals;
    @Autowired NoteService notes;

    @Test
    void staleWriteIsRejected() {
        String currency = uniqueCurrency();
        totals.createIfMissing(currency);
        NoteTotals read = totals.find(currency).orElseThrow();      // two writers read version 0
        totals.update(read.add(Money.of(10, currency)));           // first wins: version 1
        assertThatThrownBy(() -> totals.update(read.add(Money.of(20, currency))))
                .isInstanceOf(OptimisticLockException.class);
        assertThat(totals.find(currency).orElseThrow()).isEqualTo(new NoteTotals(Money.of(10, currency), 1, 1));
    }

    @Test
    void concurrentWritersWithRetryLoseNothing() throws Exception {
        String currency = uniqueCurrency();
        int writers = 8, perWriter = 10;
        try (ExecutorService pool = Executors.newFixedThreadPool(writers)) {
            List<Future<?>> futures = new ArrayList<>();
            for (int w = 0; w < writers; w++) {
                futures.add(pool.submit(() -> {
                    for (int i = 0; i < perWriter; i++) {
                        OptimisticRetry.run(50, () -> notes.addToTotals(Money.of(3, currency)));
                    }
                }));
            }
            for (Future<?> f : futures) f.get();
        }
        NoteTotals t = totals.find(currency).orElseThrow();
        assertThat(t.total()).isEqualTo(Money.of(3L * writers * perWriter, currency));
        assertThat(t.noteCount()).isEqualTo((long) writers * perWriter);
        assertThat(t.version()).isEqualTo((long) writers * perWriter);
    }
}
