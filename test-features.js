/**
 * Test Dynamic Interval Calculation
 * Run this in extension background service worker console
 */

// Test interval calculation logic
function testIntervalCalculation() {
    const INTERVALS = {
        ACTIVE_TAB: 45 / 60,
        BACKGROUND: 5,
        NEAR_TARGET: 2,
        POST_ALERT: 15
    };

    function calculateInterval(currentPrice, targetPrice, wasNotified) {
        if (wasNotified) {
            return INTERVALS.POST_ALERT;
        }
        
        const percentAboveTarget = ((currentPrice - targetPrice) / targetPrice) * 100;
        
        if (percentAboveTarget <= 10 && percentAboveTarget > 0) {
            return INTERVALS.NEAR_TARGET;
        }
        
        return INTERVALS.BACKGROUND;
    }

    // Test cases
    const tests = [
        // [currentPrice, targetPrice, wasNotified, expectedInterval]
        [1000, 1000, false, INTERVALS.BACKGROUND],  // At target
        [990, 1000, false, INTERVALS.BACKGROUND],   // Below target
        [1100, 1000, false, INTERVALS.NEAR_TARGET], // 10% above (1100 = 110% of 1000)
        [1050, 1000, false, INTERVALS.NEAR_TARGET], // 5% above
        [1200, 1000, false, INTERVALS.BACKGROUND],  // 20% above
        [1000, 1000, true, INTERVALS.POST_ALERT],   // Already notified
    ];

    console.log('🧪 Testing Dynamic Interval Calculation:\n');
    
    let passed = 0;
    let failed = 0;

    tests.forEach(([current, target, notified, expected], index) => {
        const result = calculateInterval(current, target, notified);
        const match = result === expected;
        
        if (match) {
            passed++;
            console.log(`✅ Test ${index + 1}: PASS`);
        } else {
            failed++;
            console.log(`❌ Test ${index + 1}: FAIL`);
        }
        
        console.log(`   Current: ₹${current}, Target: ₹${target}, Notified: ${notified}`);
        console.log(`   Expected: ${expected}m, Got: ${result}m\n`);
    });

    console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
    return failed === 0;
}

// Test state-based notification logic
function testNotificationLogic() {
    console.log('\n🧪 Testing State-Based Notification Logic:\n');

    const scenarios = [
        {
            name: 'First time below target',
            current: 1200,
            target: 1290,
            lastNotified: null,
            shouldNotify: true
        },
        {
            name: 'Price unchanged',
            current: 1200,
            target: 1290,
            lastNotified: 1200,
            shouldNotify: false
        },
        {
            name: 'Price dropped further',
            current: 1180,
            target: 1290,
            lastNotified: 1200,
            shouldNotify: true
        },
        {
            name: 'Price same as last notification',
            current: 1180,
            target: 1290,
            lastNotified: 1180,
            shouldNotify: false
        },
        {
            name: 'Price increased but still below target',
            current: 1250,
            target: 1290,
            lastNotified: 1180,
            shouldNotify: true
        }
    ];

    let passed = 0;
    let failed = 0;

    scenarios.forEach(({ name, current, target, lastNotified, shouldNotify }, index) => {
        const belowTarget = current <= target;
        const priceChanged = lastNotified === null || lastNotified !== current;
        const result = belowTarget && priceChanged;
        
        const match = result === shouldNotify;
        
        if (match) {
            passed++;
            console.log(`✅ Test ${index + 1}: ${name}`);
        } else {
            failed++;
            console.log(`❌ Test ${index + 1}: ${name}`);
        }
        
        console.log(`   Current: ₹${current}, Target: ₹${target}, Last Notified: ${lastNotified || 'null'}`);
        console.log(`   Expected: ${shouldNotify ? 'NOTIFY' : 'SKIP'}, Got: ${result ? 'NOTIFY' : 'SKIP'}\n`);
    });

    console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
    return failed === 0;
}

// Run all tests
function runAllTests() {
    console.log('═══════════════════════════════════════');
    console.log('  PRICEWATCH - FEATURE TEST SUITE');
    console.log('═══════════════════════════════════════\n');
    
    const test1 = testIntervalCalculation();
    const test2 = testNotificationLogic();
    
    console.log('\n═══════════════════════════════════════');
    if (test1 && test2) {
        console.log('  ✅ ALL TESTS PASSED');
    } else {
        console.log('  ❌ SOME TESTS FAILED');
    }
    console.log('═══════════════════════════════════════\n');
}

// Auto-run in browser console
if (typeof window !== 'undefined') {
    runAllTests();
}

// Export for Node.js testing
if (typeof module !== 'undefined') {
    module.exports = { testIntervalCalculation, testNotificationLogic, runAllTests };
}
