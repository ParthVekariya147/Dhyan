/**
 * The યુવક app's view of the shared domain constants.
 *
 * The definitions live in shared/domain/constants.js so that the સંચાલક panel (admin/)
 * cannot drift from them — in particular the સબઝોન list and ADMIN_MOBILES. This file
 * stays so every existing `../lib/constants` import keeps working unchanged.
 */
export * from '../../shared/domain/constants.js';
